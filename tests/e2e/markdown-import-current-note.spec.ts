import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectBodyEditorValue } from "./body-editor";

type StoredNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  pinnedAt?: number;
  marp?: {
    enabled: true;
    theme: "default" | "gaia" | "uncover";
    size: "16:9" | "4:3";
    paginate: boolean;
    headingDivider: 1 | 2 | 3;
  };
  customMetadata?: Array<{ key: string; value: string }>;
};

async function seedSavedNote(page: Page, note: StoredNote) {
  await page.goto("/");
  // Create one note through the app first so its IndexedDB upgrade has
  // completed before the test replaces the store with exact fixture data.
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByLabel("Title").fill("Seed setup");
  await page.getByLabel("Body").fill("Seed setup");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Status: Saved")).toBeVisible();
  await page.evaluate(async (item) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("markdown-knowledge-board", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("notes", "readwrite");
    const store = transaction.objectStore("notes");
    store.clear();
    store.put(item);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, note);
  await page.reload();
  await page.locator(".note-title", { hasText: note.title }).click();
}

async function readStoredNotes(page: Page): Promise<StoredNote[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("markdown-knowledge-board", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("notes", "readonly");
    const request = transaction.objectStore("notes").getAll();
    const notes = await new Promise<StoredNote[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredNote[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return notes;
  });
}

async function dropMarkdownFiles(
  page: Page,
  target:
    | "#body"
    | ".editor-body:not([hidden])"
    | ".preview-panel:not([hidden])",
  files: Array<{ name: string; content: string }>
) {
  return page.locator(target).evaluate(
    (element, payload) => {
      const dataTransfer = new DataTransfer();
      for (const file of payload) {
        dataTransfer.items.add(
          new File([file.content], file.name, { type: "text/markdown" })
        );
      }
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    files
  );
}

async function dropMarkdown(
  page: Page,
  target:
    | "#body"
    | ".editor-body:not([hidden])"
    | ".preview-panel:not([hidden])",
  file: { name: string; content: string }
) {
  return dropMarkdownFiles(page, target, [file]);
}

async function dropMarkdownFileFromDisk(
  page: Page,
  target: "#body" | ".preview-panel:not([hidden])",
  filePath: string
) {
  const box = await page.locator(target).boundingBox();
  if (!box) {
    throw new Error(`Drop target is not visible: ${target}`);
  }

  const client = await page.context().newCDPSession(page);
  const dragData = {
    items: [{ mimeType: "text/plain", data: "" }],
    files: [filePath],
    dragOperationsMask: 1,
  };
  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };

  for (const type of ["dragEnter", "dragOver", "drop"] as const) {
    await client.send("Input.dispatchDragEvent", {
      type,
      ...point,
      data: dragData,
    });
  }
}

async function expectResultValue(dialog: Locator, label: string, value: string) {
  await expect(
    dialog.locator(".result-summary div", { hasText: label }).locator("dd")
  ).toHaveText(value);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("keeps a new Draft unchanged when its import choice is canceled", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Unsaved Draft");
  await page.getByLabel("Body").fill("Draft body must remain");

  await dropMarkdown(page, "#body", {
    name: "must-not-be-inserted.md",
    content: "Markdown dropped from a file",
  });
  await page
    .getByRole("dialog", { name: "Import Markdown File" })
    .getByRole("button", { name: "Cancel" })
    .click();

  await expectBodyEditorValue(
    page.getByLabel("Body"),
    "Draft body must remain"
  );
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Unsaved Draft"
  );
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  await expect(
    page.getByRole("dialog", { name: "Unsaved Changes" })
  ).toHaveCount(0);
});

test("replaces only a new Draft body without an unsaved confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Draft title");
  await page.getByLabel("Tags").fill("Draft tag");
  await page.keyboard.press("Enter");
  await page.getByLabel("Body").fill("Old Draft body");

  await dropMarkdown(page, "#body", {
    name: "draft-replacement.md",
    content: [
      "---",
      "title: Source title must be ignored",
      "tags:",
      "  - Source tag",
      "---",
      "# New Draft body",
    ].join("\n"),
  });
  await page
    .getByRole("dialog", { name: "Import Markdown File" })
    .getByRole("button", { name: "Replace Current Note Body" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Updated", "1");
  await resultDialog.getByRole("button", { name: "Close" }).click();
  await expectBodyEditorValue(page.getByLabel("Body"), "# New Draft body");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Draft title"
  );
  await expect(page.locator(".tag-chip", { hasText: "Draft tag" })).toBeVisible();
  await expect(
    page.locator(".tag-chip", { hasText: "Source tag" })
  ).toHaveCount(0);
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  await expect(
    page.getByRole("dialog", { name: "Unsaved Changes" })
  ).toHaveCount(0);
  expect(await readStoredNotes(page)).toEqual([]);
});

test("replaces a Draft body from a native filesystem drop", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Chromium CDP is required to emulate an operating-system file drop."
  );
  const replacementPath = testInfo.outputPath("native-draft-replacement.md");
  await writeFile(replacementPath, "# Native Draft replacement", "utf8");

  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Native Drop Draft");
  await page.getByLabel("Body").fill("Old native Draft body");

  await dropMarkdownFileFromDisk(page, "#body", replacementPath);
  await page
    .getByRole("dialog", { name: "Import Markdown File" })
    .getByRole("button", { name: "Replace Current Note Body" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Updated", "1");
  await resultDialog.getByRole("button", { name: "Close" }).click();
  await expectBodyEditorValue(
    page.getByLabel("Body"),
    "# Native Draft replacement"
  );
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  expect(await readStoredNotes(page)).toEqual([]);
});

test("adds a dropped file as a new note while preserving the current Draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Draft to keep");
  await page.getByLabel("Body").fill("Keep this Draft body");

  await dropMarkdown(page, "#body", {
    name: "new-note.md",
    content: "---\ntitle: Imported note\n---\nImported body",
  });
  await page
    .getByRole("dialog", { name: "Import Markdown File" })
    .getByRole("button", { name: "Add as New Note" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Added", "1");
  await resultDialog.getByRole("button", { name: "Close" }).click();
  await expectBodyEditorValue(page.getByLabel("Body"), "Keep this Draft body");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Draft to keep"
  );
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  await expect(
    page.getByRole("dialog", { name: "Unsaved Changes" })
  ).toHaveCount(0);
  expect(await readStoredNotes(page)).toMatchObject([
    {
      title: "Imported note",
      body: "Imported body",
    },
  ]);
});

test("adds multiple dropped files while keeping Draft replacement disabled", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Multiple Draft");
  await page.getByLabel("Body").fill("Keep multiple Draft body");

  await dropMarkdownFiles(page, "#body", [
    { name: "first.md", content: "First imported body" },
    { name: "second.md", content: "Second imported body" },
  ]);
  const choiceDialog = page.getByRole("dialog", {
    name: "Import Markdown Files",
  });
  await expect(
    choiceDialog.getByRole("button", { name: "Replace Current Note Body" })
  ).toBeDisabled();
  await choiceDialog
    .getByRole("button", { name: "Add as New Notes" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Added", "2");
  await resultDialog.getByRole("button", { name: "Close" }).click();
  await expectBodyEditorValue(
    page.getByLabel("Body"),
    "Keep multiple Draft body"
  );
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Multiple Draft"
  );
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  expect(await readStoredNotes(page)).toHaveLength(2);
});

test("replaces a Draft body dropped on Preview without saving the Draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Preview Draft");
  await page.getByLabel("Body").fill("Old Preview Draft body");
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  await dropMarkdown(page, ".preview-panel:not([hidden])", {
    name: "preview-draft.md",
    content: "# Preview Draft replacement",
  });
  await page
    .getByRole("dialog", { name: "Import Markdown File" })
    .getByRole("button", { name: "Replace Current Note Body" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Updated", "1");
  await resultDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".preview-panel:not([hidden])")).toContainText(
    "Preview Draft replacement"
  );
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expectBodyEditorValue(
    page.getByLabel("Body"),
    "# Preview Draft replacement"
  );
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Preview Draft"
  );
  expect(await readStoredNotes(page)).toEqual([]);
});

test("keeps a saved Edit body unchanged when the import choice is canceled", async ({
  page,
}) => {
  const original: StoredNote = {
    id: "cancel-clean-note",
    title: "Cancel clean note",
    body: "Saved body must remain",
    tags: [],
    updatedAt: 1_700_000_000_000,
  };
  await seedSavedNote(page, original);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await dropMarkdown(page, "#body", {
    name: "must-not-be-inserted.md",
    content: "Markdown dropped from a file",
  });
  await page
    .getByRole("dialog", { name: "Import Markdown File" })
    .getByRole("button", { name: "Cancel" })
    .click();

  await expectBodyEditorValue(page.getByLabel("Body"), original.body);
  await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
  expect(await readStoredNotes(page)).toEqual([original]);
});

test("replaces only the current Preview note body and preserves its metadata", async ({
  page,
}) => {
  const original: StoredNote = {
    id: "current-note",
    title: "Current note",
    body: "# Original body",
    tags: ["Keep", "Metadata"],
    updatedAt: 1_700_000_000_000,
    pinnedAt: 1_700_000_000_100,
    marp: {
      enabled: true,
      theme: "gaia",
      size: "4:3",
      paginate: false,
      headingDivider: 2,
    },
    customMetadata: [{ key: "owner", value: "Keep this owner" }],
  };
  await seedSavedNote(page, original);
  const previewTab = page.getByRole("button", {
    name: "Preview",
    exact: true,
  });
  await previewTab.click();
  await previewTab.focus();
  const externalMarkdown = [
    "---",
    "id: source-note",
    "title: Source title must be ignored",
    "updatedAt: 1900000000000",
    "tags:",
    "  - Source tag",
    "marp: false",
    "owner: Source owner",
    "---",
    "# Replacement body",
    "",
    "Updated outside the app.",
  ].join("\n");

  expect(
    await dropMarkdown(page, ".preview-panel:not([hidden])", {
      name: "external-source.md",
      content: externalMarkdown,
    })
  ).toBe(true);

  const choiceDialog = page.getByRole("dialog", {
    name: "Import Markdown File",
  });
  await expect(choiceDialog).toContainText('Current note: "Current note"');
  await expect(choiceDialog).toContainText(
    "title, tags, Marp settings, custom metadata, and pinned state will be preserved"
  );
  await expect(
    choiceDialog.getByRole("button", { name: "Cancel" })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    choiceDialog.getByRole("button", { name: "Add as New Note" })
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    choiceDialog.getByRole("button", { name: "Cancel" })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(choiceDialog).toHaveCount(0);
  await expect(previewTab).toBeFocused();

  await dropMarkdown(page, ".preview-panel:not([hidden])", {
    name: "external-source.md",
    content: externalMarkdown,
  });
  await choiceDialog
    .getByRole("button", { name: "Replace Current Note Body" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Added", "0");
  await expectResultValue(resultDialog, "Updated", "1");
  await expectResultValue(resultDialog, "Skipped", "0");
  await expectResultValue(resultDialog, "Failed", "0");
  await expect(page.locator(".preview-panel:not([hidden])")).toContainText(
    "Updated outside the app."
  );

  const [stored] = await readStoredNotes(page);
  expect(stored).toEqual({
    ...original,
    body: "# Replacement body\n\nUpdated outside the app.",
    updatedAt: expect.any(Number),
  });
  expect(stored.updatedAt).toBeGreaterThan(original.updatedAt);
});

test("adds a new note even when Markdown ID, title, and updatedAt match", async ({
  page,
}) => {
  const original: StoredNote = {
    id: "matching-id",
    title: "Matching title",
    body: "Original body must remain",
    tags: ["Original"],
    updatedAt: 1_700_000_000_000,
  };
  await seedSavedNote(page, original);

  await dropMarkdown(page, "#body", {
    name: "matching.md",
    content: [
      "---",
      "id: matching-id",
      "title: Matching title",
      "updatedAt: 1700000000000",
      "---",
      "Imported as a separate note",
    ].join("\n"),
  });
  const choiceDialog = page.getByRole("dialog", {
    name: "Import Markdown File",
  });
  await choiceDialog
    .getByRole("button", { name: "Add as New Note" })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(resultDialog, "Added", "1");
  await expectResultValue(resultDialog, "Updated", "0");

  const storedNotes = await readStoredNotes(page);
  expect(storedNotes).toHaveLength(2);
  expect(storedNotes.find((note) => note.id === original.id)).toEqual(original);
  const imported = storedNotes.find((note) => note.id !== original.id);
  expect(imported).toMatchObject({
    title: "Matching title",
    body: "Imported as a separate note",
    updatedAt: original.updatedAt,
  });
  expect(imported?.id).not.toBe("matching-id");
});

test("keeps an unsaved Edit draft when replacement is canceled", async ({
  page,
}) => {
  const original: StoredNote = {
    id: "dirty-note",
    title: "Dirty note",
    body: "Persisted body",
    tags: [],
    updatedAt: 1_700_000_000_000,
  };
  await seedSavedNote(page, original);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Body").fill("Unsaved body");

  await dropMarkdown(page, "#body", {
    name: "replacement.md",
    content: "Replacement must not be applied",
  });
  const choiceDialog = page.getByRole("dialog", {
    name: "Import Markdown File",
  });
  await page.keyboard.press("Escape");
  await expect(choiceDialog).toHaveCount(0);
  await expect(page.getByLabel("Body")).toBeFocused();
  await expectBodyEditorValue(page.getByLabel("Body"), "Unsaved body");

  await dropMarkdown(page, "#body", {
    name: "replacement.md",
    content: "Replacement must not be applied",
  });
  await choiceDialog
    .getByRole("button", { name: "Replace Current Note Body" })
    .click();

  const unsavedDialog = page.getByRole("dialog", { name: "Unsaved Changes" });
  await expect(unsavedDialog).toContainText("replace the current note body");
  await unsavedDialog.getByRole("button", { name: "Cancel" }).click();

  await expectBodyEditorValue(page.getByLabel("Body"), "Unsaved body");
  await expect(
    page.getByRole("dialog", { name: "Import Complete" })
  ).toHaveCount(0);
  expect(await readStoredNotes(page)).toEqual([original]);
});

for (const scenario of [
  {
    choice: "Save and Continue",
    expectedTitle: "Unsaved title",
  },
  {
    choice: "Discard and Continue",
    expectedTitle: "Persisted title",
  },
] as const) {
  test(`applies ${scenario.choice} before replacing a dirty note body`, async ({
    page,
  }) => {
    const original: StoredNote = {
      id: `dirty-${scenario.choice}`,
      title: "Persisted title",
      body: "Persisted body",
      tags: ["Persisted tag"],
      updatedAt: 1_700_000_000_000,
    };
    await seedSavedNote(page, original);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Title" })
      .fill("Unsaved title");
    await page.getByLabel("Body").fill("Unsaved body");

    await dropMarkdown(page, "#body", {
      name: "replacement.md",
      content: "Body from external file",
    });
    await page
      .getByRole("dialog", { name: "Import Markdown File" })
      .getByRole("button", { name: "Replace Current Note Body" })
      .click();
    await page
      .getByRole("dialog", { name: "Unsaved Changes" })
      .getByRole("button", { name: scenario.choice })
      .click();

    const resultDialog = page.getByRole("dialog", {
      name: "Import Complete",
    });
    await expectResultValue(resultDialog, "Updated", "1");
    const [stored] = await readStoredNotes(page);
    expect(stored).toMatchObject({
      id: original.id,
      title: scenario.expectedTitle,
      body: "Body from external file",
      tags: original.tags,
    });
    expect(stored.updatedAt).toBeGreaterThan(original.updatedAt);
  });
}
