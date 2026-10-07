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

const activationOriginal: StoredNote = {
  id: "activation-original",
  title: "Activation original",
  body: "Original body",
  tags: ["original"],
  updatedAt: 1_700_000_000_000,
  pinnedAt: 1_700_000_000_000,
};

async function importActivationFiles(
  page: Page,
  method: "drop" | "picker",
  files = [{ name: "activated.md", content: "---\ntitle: Activated note\n---\nActivated body" }],
  tab: "Edit" | "Preview" = "Edit",
) {
  if (method === "picker") {
    await page.setInputFiles("#import-markdown", files.map((file) => ({
      name: file.name,
      mimeType: "text/markdown",
      buffer: Buffer.from(file.content),
    })));
  } else {
    await dropMarkdownFiles(page, tab === "Edit" ? "#body" : ".preview-panel:not([hidden])", files);
    await page.getByRole("dialog", { name: /Import Markdown File/ })
      .getByRole("button", { name: /Add as New Note/ }).click();
  }
}

for (const method of ["drop", "picker"] as const) {
  for (const tab of ["Edit", "Preview"] as const) {
    test(`auto-activation selects a saved import from ${method} and preserves ${tab}`, { tag: '@ci-smoke' }, async ({ page }) => {
      await seedSavedNote(page, activationOriginal);
      await page.getByRole("button", { name: tab, exact: true }).click();
      await importActivationFiles(page, method, undefined, tab);
      const result = page.getByRole("dialog", { name: "Import Complete" });
      await expectResultValue(result, "Added", "1");
      await result.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("button", { name: "Open note: Activated note" }))
        .toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("button", { name: tab, exact: true })).toHaveClass(/active/);
      if (tab === "Edit") {
        await expect(page.getByLabel("Title")).toHaveValue("Activated note");
        await expectBodyEditorValue(page.getByLabel("Body"), "Activated body");
      } else {
        await expect(page.locator(".preview-panel:not([hidden])")).toContainText("Activated body");
      }
      expect((await readStoredNotes(page)).find((note) => note.id === activationOriginal.id))
        .toEqual(activationOriginal);
      await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
    });
  }

  for (const choice of ["Save and Continue", "Discard and Continue", "Cancel"] as const) {
    test(`auto-activation protects initially dirty notes after ${choice} via ${method}`, async ({ page }) => {
      await seedSavedNote(page, activationOriginal);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Body").fill("Unsaved body to protect");
      await importActivationFiles(page, method);
      await page.getByRole("dialog", { name: "Unsaved Changes" })
        .getByRole("button", { name: choice, exact: true }).click();
      if (choice !== "Cancel") {
        await page.getByRole("dialog", { name: "Import Complete" })
          .getByRole("button", { name: "Close" }).click();
      }
      await expect(page.getByRole("button", { name: "Open note: Activation original" }))
        .toHaveAttribute("aria-current", "true");
      await expectBodyEditorValue(page.getByLabel("Body"),
        choice === "Discard and Continue" ? "Original body" : "Unsaved body to protect");
      const stored = await readStoredNotes(page);
      expect(stored).toHaveLength(choice === "Cancel" ? 1 : 2);
      expect(stored.find((note) => note.id === activationOriginal.id)?.body)
        .toBe(choice === "Save and Continue" ? "Unsaved body to protect" : "Original body");
    });
  }
}

test("auto-activation chooses the first successful file regardless of list sort", { tag: '@ci-smoke' }, async ({ page }) => {
  await seedSavedNote(page, activationOriginal);
  await importActivationFiles(page, "picker", [
    { name: "invalid.md", content: "---\ntitle: [broken\n---\nInvalid" },
    { name: "first.txt", content: "---\ntitle: First success\nupdatedAt: 1\n---\nFirst body" },
    { name: "second.markdown", content: "---\ntitle: Second success\n---\nSecond body" },
  ]);
  const result = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(result, "Added", "2");
  await expectResultValue(result, "Failed", "1");
  await result.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Open note: First success" }))
    .toHaveAttribute("aria-current", "true");
});

test("auto-activation leaves selection unchanged when every save fails", async ({ page }) => {
  await seedSavedNote(page, activationOriginal);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (value.title === "Activated note") throw new DOMException("Test quota failure", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  await importActivationFiles(page, "picker");
  const result = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(result, "Added", "0");
  await expectResultValue(result, "Failed", "1");
  await result.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Open note: Activation original" }))
    .toHaveAttribute("aria-current", "true");
  expect(await readStoredNotes(page)).toEqual([activationOriginal]);
});

test("metadata expansion limits preserve saved notes and allow a subsequent import", async ({ page }) => {
  await seedSavedNote(page, activationOriginal);
  const aliases = ["a0: &a0 [leaf, leaf, leaf, leaf, leaf, leaf, leaf, leaf, leaf, leaf]"];
  for (let level = 1; level <= 4; level += 1) {
    aliases.push(`a${level}: &a${level} [${Array(10).fill(`*a${level - 1}`).join(", ")}]`);
  }
  await importActivationFiles(page, "picker", [{
    name: "oversized.md",
    content: `---\n${aliases.join("\n")}\n---\nBody`,
  }]);
  const result = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(result, "Added", "0");
  await expectResultValue(result, "Failed", "1");
  await expect(result).toContainText("Metadata expands beyond");
  await result.getByRole("button", { name: "Close" }).click();
  expect(await readStoredNotes(page)).toEqual([activationOriginal]);
  await expect(page.getByRole("button", { name: "Open note: Activation original" }))
    .toHaveAttribute("aria-current", "true");

  await importActivationFiles(page, "picker", [{
    name: "valid-alias.md",
    content: "---\ntitle: Valid alias\nowner: &owner Team\nreviewer: *owner\n---\nValid body",
  }]);
  await expectResultValue(result, "Added", "1");
  await expectResultValue(result, "Failed", "0");
  await result.getByRole("button", { name: "Close" }).click();
  const stored = await readStoredNotes(page);
  expect(stored.find((note) => note.id === activationOriginal.id)).toEqual(activationOriginal);
  expect(stored.find((note) => note.title === "Valid alias")?.customMetadata).toEqual([
    { key: "owner", value: "Team" },
    { key: "reviewer", value: "Team" },
  ]);
});

test("metadata expansion limits show combined field errors before applying", async ({ page }) => {
  await seedSavedNote(page, activationOriginal);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Metadata", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Metadata", exact: true });
  // Each row is valid alone; the complete collection exceeds the shared budget.
  const value = `[${Array(1000).fill("null").join(",")}]`;
  for (let index = 0; index < 10; index += 1) {
    await dialog.getByRole("button", { name: "Add custom field" }).click();
    await dialog.locator(".metadata-custom-key").nth(index).fill(`field${index}`);
    await dialog.locator(".metadata-custom-value").nth(index).fill(value);
  }
  await expect(dialog.getByRole("status")).toContainText("Metadata expands beyond");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await dialog.locator(".metadata-custom-value").last().fill("valid");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await readStoredNotes(page)).toEqual([activationOriginal]);
});

async function delayActivationRead(page: Page) {
  await page.evaluate(() => {
    const gate = window as typeof window & { activationReadStarted?: boolean; releaseActivationRead?: () => void };
    const original = File.prototype.text;
    File.prototype.text = async function() {
      gate.activationReadStarted = true;
      await new Promise<void>((resolve) => { gate.releaseActivationRead = resolve; });
      return original.call(this);
    };
  });
}

for (const action of ["edit", "save", "revert", "select round trip"] as const) {
  test(`auto-activation protects a ${action} during a delayed read`, { tag: '@ci-smoke' }, async ({ page }) => {
    await seedSavedNote(page, activationOriginal);
    // Prepare a second persisted note so selection can leave and return.
    await page.getByRole("button", { name: /new note/i }).click();
    await page.getByLabel("Title").fill("Other note");
    await page.getByLabel("Body").fill("Other body");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
    await page.getByRole("button", { name: "Open note: Activation original" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await delayActivationRead(page);
    await importActivationFiles(page, "picker");
    await page.waitForFunction(() => (window as typeof window & { activationReadStarted?: boolean }).activationReadStarted);
    if (action === "select round trip") {
      await page.getByRole("button", { name: "Open note: Other note" }).click();
      await page.getByRole("button", { name: "Open note: Activation original" }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
    } else {
      await page.getByLabel("Body").fill("Edited during import");
      if (action === "save") {
        await page.getByRole("button", { name: /^Save$/ }).click();
        await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
      } else if (action === "revert") {
        await page.getByRole("button", { name: "Revert changes", exact: true }).click();
        await page.getByRole("dialog", { name: "Revert changes?" })
          .getByRole("button", { name: "Revert Changes", exact: true }).click();
      }
    }
    await page.evaluate(() => (window as typeof window & { releaseActivationRead?: () => void }).releaseActivationRead?.());
    await page.getByRole("dialog", { name: "Import Complete" })
      .getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Open note: Activation original" }))
      .toHaveAttribute("aria-current", "true");
    const expectedBody = action === "save" || action === "edit" ? "Edited during import" : "Original body";
    await expectBodyEditorValue(page.getByLabel("Body"), expectedBody);
    expect((await readStoredNotes(page)).find((note) => note.id === activationOriginal.id)?.body)
      .toBe(action === "save" ? expectedBody : "Original body");
    if (action === "edit") return;
    // Reopen to verify the list state did not overwrite the concurrent save.
    await page.getByRole("button", { name: "Open note: Other note" }).click();
    await page.getByRole("button", { name: "Open note: Activation original" }).click();
    await expect(page.locator(".preview-panel:not([hidden])")).toContainText(expectedBody);
  });
}

test("auto-activation keeps filters while selecting a hidden imported note", async ({ page }) => {
  await seedSavedNote(page, activationOriginal);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Filter notes" });
  await filter.getByRole("searchbox", { name: "Search" }).fill("Activation original");
  await filter.getByRole("button", { name: "Apply Filters" }).click();
  await importActivationFiles(page, "picker", undefined, "Preview");
  await page.getByRole("dialog", { name: "Import Complete" })
    .getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".preview-panel:not([hidden])")).toContainText("Activated body");
  await expect(page.getByRole("button", { name: "Open note: Activated note" })).toHaveCount(0);
  await expect(page.locator(".note-count")).toHaveText("(1 of 2)");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open note: Activated note" }))
    .toHaveAttribute("aria-current", "true");
});

for (const offline of [false, true]) {
  test(`auto-activation handles no selection ${offline ? "offline" : "online"} without leaving the mobile list`, async ({ page, context, browserName }, testInfo) => {
    test.skip(offline && browserName === "webkit",
      "WebKit offline emulation makes File.text() fail even for an in-memory File without the app. See the validation notes.");
    // Exercise the file picker with a real local file, independently of uploads
    // created from buffers by the test runner.
    const filePath = testInfo.outputPath("activated.md");
    await writeFile(filePath, "---\ntitle: Activated note\n---\nActivated body", "utf8");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Import Markdown", exact: true })).toBeVisible();
    await context.setOffline(offline);
    await page.setInputFiles("#import-markdown", filePath);
    const result = page.getByRole("dialog", { name: "Import Complete" });
    await expectResultValue(result, "Added", "1");
    await expectResultValue(result, "Failed", "0");
    await result.getByRole("button", { name: "Close" }).click();
    const card = page.getByRole("button", { name: "Open note: Activated note" });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-current", "true");
    expect(await readStoredNotes(page)).toHaveLength(1);
  });
}

test("auto-activation preserves empty Draft and uncommitted tags", { tag: '@ci-smoke' }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByRole("combobox", { name: "Tags" }).fill("pending-tag");
  await importActivationFiles(page, "drop");
  await page.getByRole("dialog", { name: "Import Complete" })
    .getByRole("button", { name: "Close" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("");
  await expectBodyEditorValue(page.getByLabel("Body"), "");
  await expect(page.getByRole("combobox", { name: "Tags" })).toHaveValue("pending-tag");
  await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
  expect(await readStoredNotes(page)).toHaveLength(1);
});

test("auto-activation rejects another import while a read is pending", async ({ page }) => {
  await seedSavedNote(page, activationOriginal);
  await delayActivationRead(page);
  await importActivationFiles(page, "picker");
  await page.waitForFunction(() => (window as typeof window & { activationReadStarted?: boolean }).activationReadStarted);
  await dropMarkdown(page, ".preview-panel:not([hidden])", { name: "ignored.md", content: "Ignored body" });
  await expect(page.getByRole("dialog", { name: /Import Markdown File/ })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { releaseActivationRead?: () => void }).releaseActivationRead?.());
  const result = page.getByRole("dialog", { name: "Import Complete" });
  await expectResultValue(result, "Added", "1");
  await result.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Open note: Activated note" }))
    .toHaveAttribute("aria-current", "true");
  expect(await readStoredNotes(page)).toHaveLength(2);
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
