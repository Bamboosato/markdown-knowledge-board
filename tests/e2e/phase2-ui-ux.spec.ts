import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

declare global {
  interface Window {
    __backupFileName?: string;
    __backupText?: string;
  }
}

async function createSavedNote(
  page: Page,
  title: string,
  body: string,
  tags: string[] = []
) {
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByLabel("Title").fill(title);
  for (const tag of tags) {
    await page.getByLabel("Tags").fill(tag);
    await page.keyboard.press("Enter");
  }
  await page.getByLabel("Body").fill(body);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Status: Saved")).toBeVisible();
}

async function expectResultValue(dialog: Locator, label: string, value: string) {
  await expect(dialog.locator(".result-summary div", { hasText: label }).locator("dd")).toHaveText(
    value
  );
}

async function mockBackupSavePicker(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async (options?: { suggestedName?: string }) => {
        window.__backupFileName = options?.suggestedName;
        return {
          createWritable: async () => ({
            write: async (blob: Blob) => {
              window.__backupText = await blob.text();
            },
            close: async () => {},
          }),
        };
      },
    });
  });
}

async function mockBackupCancelPicker(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      },
    });
  });
}

test.describe("Phase 2 bulk operations and accessibility", () => {
  test("shows backup results only after the save picker writes the file", async ({ page }) => {
    await mockBackupSavePicker(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Backup All Notes" }).click();
    await expect(
      page.getByRole("dialog", { name: "Backup Complete" })
    ).toBeVisible();
    const emptyFileName = await page.evaluate(() => window.__backupFileName);
    const emptyBackup = await page.evaluate(() =>
      JSON.parse(window.__backupText ?? "{}")
    );
    await expect(page.getByText(emptyFileName ?? "")).toBeVisible();
    await expectResultValue(
      page.getByRole("dialog", { name: "Backup Complete" }),
      "Notes",
      "0"
    );
    expect(emptyBackup.noteCount).toBe(0);
    await page.getByRole("button", { name: "Close" }).click();

    await createSavedNote(page, "Phase 2 backup note", "# Phase 2\n\nBackup body");
    await page.getByRole("button", { name: "Notes" }).click();

    await page.getByRole("button", { name: "Backup All Notes" }).click();
    await expect(
      page.getByRole("dialog", { name: "Backup Complete" })
    ).toBeVisible();
    const fileName = await page.evaluate(() => window.__backupFileName);
    const backup = await page.evaluate(() =>
      JSON.parse(window.__backupText ?? "{}")
    );
    await expect(page.getByText(fileName ?? "")).toBeVisible();
    await expectResultValue(
      page.getByRole("dialog", { name: "Backup Complete" }),
      "Notes",
      "1"
    );
    expect(backup.noteCount).toBe(1);
    expect(backup.notes).toHaveLength(1);
  });

  test("does not show a backup result dialog when the save picker is canceled", async ({
    page,
  }) => {
    await mockBackupCancelPicker(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Backup All Notes" }).click();

    await expect(
      page.getByRole("dialog", { name: /Backup/ })
    ).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("lastBackupAt"))).toBeNull();
  });

  test("summarizes duplicate and failed import results", async ({ page }) => {
    await mockBackupSavePicker(page);
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 import source",
      "# Phase 2 import source\n\nImport body"
    );
    await page.getByRole("button", { name: "Notes" }).click();
    await page.getByRole("button", { name: "Backup All Notes" }).click();
    await expect(
      page.getByRole("dialog", { name: "Backup Complete" })
    ).toBeVisible();
    const backupText = await page.evaluate(() => window.__backupText ?? "");
    await page.getByRole("button", { name: "Close" }).click();

    await page.setInputFiles("#import-md", {
      name: "phase2-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText),
    });

    const duplicateDialog = page.getByRole("dialog", { name: "Import Complete" });
    await expect(duplicateDialog).toBeVisible();
    await expectResultValue(duplicateDialog, "Added", "0");
    await expectResultValue(duplicateDialog, "Updated", "0");
    await expectResultValue(duplicateDialog, "Skipped", "1");
    await expectResultValue(duplicateDialog, "Failed", "0");
    await page.getByRole("button", { name: "Close" }).click();

    await page.setInputFiles("#import-md", [
      {
        name: "valid-import.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Valid import\n\nImported body"),
      },
      {
        name: "invalid-import.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("---\ntitle: [broken\n---\n# Broken"),
      },
    ]);

    const mixedDialog = page.getByRole("dialog", { name: "Import Complete" });
    await expect(mixedDialog).toBeVisible();
    await expectResultValue(mixedDialog, "Added", "1");
    await expectResultValue(mixedDialog, "Failed", "1");
    await mixedDialog.getByText("Failed files").click();
    await expect(mixedDialog.getByText("invalid-import.md")).toBeVisible();
  });

  test("updates preview tasks from the keyboard and marks the note unsaved", async ({
    page,
  }) => {
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 task note",
      "# Phase 2 task note\n\n- [ ] Verify preview task"
    );

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByLabel("Title")).toHaveCount(0);
    await expect(page.getByLabel("Tags")).toHaveCount(0);
    const task = page.getByRole("checkbox", {
      name: "Mark task complete: Verify preview task",
    });
    await task.focus();
    await page.keyboard.press("Space");

    await expect(
      page.getByRole("checkbox", {
        name: "Mark task incomplete: Verify preview task",
      })
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Status: Unsaved changes")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Phase 2 task note");
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 task note\n\n- [x] Verify preview task"
    );
  });

  test("shows tag suggestions as a focused dropdown with filtering", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 tag source",
      "# Phase 2 tag source\n\nTag body",
      [
        "Accessibility",
        "Backup",
        "Design",
        "Import",
        "Mobile",
        "Phase1",
        "Preview",
        "Testing",
        "UI/UX",
      ]
    );

    await page.getByRole("button", { name: /new note/i }).click();
    await expect(page.getByText("No tags yet.")).toHaveCount(0);
    await expect(
      page.getByRole("listbox", { name: "Tag suggestions" })
    ).toHaveCount(0);

    const tagsInput = page.getByLabel("Tags");
    await tagsInput.focus();
    const suggestions = page.getByRole("listbox", {
      name: "Tag suggestions",
    });
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole("option")).toHaveCount(8);
    await page.locator("#tags-label").click();
    await expect(tagsInput).not.toBeFocused();
    await expect(
      page.getByRole("listbox", { name: "Tag suggestions" })
    ).toHaveCount(0);

    await tagsInput.focus();
    await expect(suggestions).toBeVisible();

    await tagsInput.fill("ui");
    await expect(
      suggestions.getByRole("option", { name: "UI/UX" })
    ).toBeVisible();
    await expect(
      suggestions.getByRole("option", { name: "Phase1" })
    ).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(page.locator(".tag-chip", { hasText: "UI/UX" })).toBeVisible();
    await expect(
      suggestions.getByRole("option", { name: "UI/UX" })
    ).toHaveCount(0);

    await tagsInput.fill("BrandNew");
    await page.keyboard.press("Enter");
    await expect(
      page.locator(".tag-chip", { hasText: "BrandNew" })
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("listbox", { name: "Tag suggestions" })
    ).toHaveCount(0);
  });

  test("filters notes from the modal without crowding the note list", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 filter match",
      "# Phase 2 filter match\n\nFilter body",
      ["Phase1", "UI/UX"]
    );
    await createSavedNote(
      page,
      "Phase 2 filter other",
      "# Phase 2 filter other\n\nFilter body",
      ["Backup"]
    );

    await expect(page.locator("#filter-search")).toHaveCount(0);
    await expect(page.locator("#filter-tags-input")).toHaveCount(0);
    await expect(page.getByText("2 notes", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("listbox", { name: "Filter tag suggestions" })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Filter notes" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("2 notes", { exact: true })).toBeVisible();

    const tagFilterLabel = dialog.locator("#filter-tags-label");
    await tagFilterLabel.click();
    await expect(
      page.getByRole("listbox", { name: "Filter tag suggestions" })
    ).toHaveCount(0);

    const searchInput = dialog.getByRole("searchbox", { name: "Search" });
    await searchInput.fill("Phase 2");

    const tagFilterInput = dialog.getByRole("combobox", { name: "Tags" });
    await tagFilterInput.focus();
    const filterSuggestions = page.getByRole("listbox", {
      name: "Filter tag suggestions",
    });
    await expect(filterSuggestions).toBeVisible();
    await expect(
      filterSuggestions.getByRole("option", { name: "Phase1" })
    ).toBeVisible();

    await tagFilterInput.fill("ui");
    await expect(
      filterSuggestions.getByRole("option", { name: "UI/UX" })
    ).toBeVisible();
    await expect(
      filterSuggestions.getByRole("option", { name: "Backup" })
    ).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(dialog.locator(".tag-chip", { hasText: "UI/UX" })).toBeVisible();
    await expect(tagFilterInput).toHaveValue("");
    await expect(
      filterSuggestions.getByRole("option", { name: "UI/UX" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Phase 2 filter match/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 2 filter other/ })
    ).toBeVisible();

    await tagFilterInput.fill("ph");
    await expect(
      filterSuggestions.getByRole("option", { name: "Phase1" })
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(dialog.locator(".tag-chip", { hasText: "Phase1" })).toBeVisible();
    await dialog.getByRole("button", { name: "Apply Filters" }).click();

    await expect(page.getByRole("button", { name: "Filter (3)" })).toBeVisible();
    await expect(page.getByText("1 of 2 notes", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 2 filter match/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 2 filter other/ })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Filter", exact: true })
    ).toBeVisible();
    await expect(page.getByText("2 notes", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 2 filter other/ })
    ).toBeVisible();

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await searchInput.fill("Phase 2");
    await tagFilterInput.fill("ui");
    await page.keyboard.press("Enter");
    await tagFilterInput.fill("ph");
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Apply Filters" }).click();

    await page.getByRole("button", { name: "Filter (3)" }).click();
    await dialog.getByRole("button", { name: "Clear Filters" }).click();
    await expect(dialog.getByText("2 notes", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Filter (3)" })).toBeVisible();

    await page.getByRole("button", { name: "Filter (3)" }).click();
    await searchInput.fill("missing");
    await dialog.getByRole("button", { name: "Apply Filters" }).click();
    await expect(
      page.getByText("No notes match your filters.")
    ).toBeVisible();
    await expect(page.getByText("0 of 2 notes", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear Filters" }).click();
    await expect(
      page.getByRole("button", { name: "Filter", exact: true })
    ).toBeVisible();
    await expect(page.getByText("2 notes", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 2 filter other/ })
    ).toBeVisible();

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const reopenedDialog = page.getByRole("dialog", { name: "Filter notes" });
    await expect(reopenedDialog).toBeVisible();
    await reopenedDialog.getByRole("combobox", { name: "Tags" }).click();
    await expect(
      page.getByRole("listbox", { name: "Filter tag suggestions" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("listbox", { name: "Filter tag suggestions" })
    ).toHaveCount(0);
  });

  test("keeps note metadata compact and the markdown toolbar sticky", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 metadata layout",
      "# Phase 2 metadata layout\n\nLayout body"
    );

    const titleLabelLocator = page.locator("#title-label");
    const tagsLabelLocator = page.locator("#tags-label");
    const bodyLabel = page.locator("#body-label");
    const titleLabel = await titleLabelLocator.boundingBox();
    const titleInput = await page.locator("#title").boundingBox();
    const tagsLabel = await tagsLabelLocator.boundingBox();
    const tagsInput = await page.locator(".tag-input").boundingBox();
    expect(titleLabel).not.toBeNull();
    expect(titleInput).not.toBeNull();
    expect(tagsLabel).not.toBeNull();
    expect(tagsInput).not.toBeNull();

    const titleLabelCenter = titleLabel!.y + titleLabel!.height / 2;
    const titleInputCenter = titleInput!.y + titleInput!.height / 2;
    const tagsLabelCenter = tagsLabel!.y + tagsLabel!.height / 2;
    const tagsInputCenter = tagsInput!.y + tagsInput!.height / 2;

    expect(Math.abs(titleLabelCenter - titleInputCenter)).toBeLessThan(6);
    expect(tagsLabel!.y).toBeGreaterThan(titleLabel!.y);
    expect(Math.abs(tagsLabelCenter - tagsInputCenter)).toBeLessThan(6);

    await page.locator("#title").blur();
    await titleLabelLocator.click();
    await expect(page.locator("#title")).not.toBeFocused();
    const tagsCombobox = page.getByRole("combobox", { name: "Tags" });
    await tagsLabelLocator.click();
    await expect(tagsCombobox).not.toBeFocused();
    await expect(
      page.getByRole("listbox", { name: "Tag suggestions" })
    ).toHaveCount(0);

    const bodyHeader = page.locator(".body-header");
    const toolbar = page.getByRole("toolbar", { name: "Markdown tools" });
    await expect(bodyHeader).toHaveCSS("position", "sticky");

    const bodyLabelBox = await bodyLabel.boundingBox();
    const desktopToolbarBox = await toolbar.boundingBox();
    expect(bodyLabelBox).not.toBeNull();
    expect(desktopToolbarBox).not.toBeNull();
    expect(desktopToolbarBox!.x).toBeGreaterThan(
      bodyLabelBox!.x + bodyLabelBox!.width
    );
    expect(Math.abs(desktopToolbarBox!.x - titleInput!.x)).toBeLessThan(2);
    expect(Math.abs(desktopToolbarBox!.x - tagsInput!.x)).toBeLessThan(2);
    expect(
      Math.abs(
        bodyLabelBox!.y +
          bodyLabelBox!.height / 2 -
          (desktopToolbarBox!.y + desktopToolbarBox!.height / 2)
      )
    ).toBeLessThan(6);
    await bodyLabel.click();
    await expect(page.locator("#body")).not.toBeFocused();

    await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveText("B");
    await expect(toolbar.getByRole("button", { name: "Italic" })).toHaveText("I");
    await expect(toolbar.getByRole("button", { name: "Strike" })).toHaveText("S");
    await expect(toolbar.getByRole("button", { name: "Code" })).toHaveText("<>");
    await expect(toolbar.getByRole("button", { name: "Bullet" })).toHaveText("-");
    await expect(toolbar.getByRole("button", { name: "Task" })).toHaveText("[ ]");
    await expect(toolbar.getByRole("button", { name: "Quote" })).toHaveText(">");
    await expect(toolbar.getByRole("button", { name: "Link" })).toHaveText("[]");
    await expect(toolbar.getByText("Bold", { exact: true })).toHaveCount(0);
    await expect(toolbar.getByText("Italic", { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 800 });
    const mobileBodyLabelBox = await bodyLabel.boundingBox();
    const mobileToolbarBox = await toolbar.boundingBox();
    expect(mobileBodyLabelBox).not.toBeNull();
    expect(mobileToolbarBox).not.toBeNull();
    expect(mobileToolbarBox!.y).toBeGreaterThan(
      mobileBodyLabelBox!.y + mobileBodyLabelBox!.height
    );
    const mobileTitleInputBox = await page.locator("#title").boundingBox();
    const mobileTagsInputBox = await page.locator(".tag-input").boundingBox();
    expect(mobileTitleInputBox).not.toBeNull();
    expect(mobileTagsInputBox).not.toBeNull();
    expect(Math.abs(mobileToolbarBox!.x - mobileTitleInputBox!.x)).toBeLessThan(
      2
    );
    expect(Math.abs(mobileToolbarBox!.x - mobileTagsInputBox!.x)).toBeLessThan(
      2
    );

    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(toolbarBox!.height).toBeLessThan(44);

    const toolbarButtons = toolbar.getByRole("button");
    const firstButtonBox = await toolbarButtons.first().boundingBox();
    expect(firstButtonBox).not.toBeNull();
    const buttonCount = await toolbarButtons.count();
    const lastButtonBox = await toolbarButtons.nth(buttonCount - 1).boundingBox();
    expect(lastButtonBox).not.toBeNull();
    expect(lastButtonBox!.x + lastButtonBox!.width).toBeLessThanOrEqual(
      mobileTagsInputBox!.x + mobileTagsInputBox!.width + 1
    );
    for (let index = 1; index < buttonCount; index += 1) {
      const buttonBox = await toolbarButtons.nth(index).boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(Math.abs(buttonBox!.y - firstButtonBox!.y)).toBeLessThan(2);
    }
  });

  test("reverts unsaved edits to the last loaded note state", async ({
    page,
  }) => {
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 revert note",
      "# Phase 2 revert note\n\nOriginal body"
    );

    await page.getByLabel("Title").fill("Changed title");
    await page.getByLabel("Body").fill("# Changed title\n\nChanged body");
    await expect(page.getByText("Status: Unsaved changes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Revert" })).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revert" }).click();

    await expect(page.getByLabel("Title")).toHaveValue("Phase 2 revert note");
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 revert note\n\nOriginal body"
    );
    await expect(page.getByText("Status: Saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Revert" })).toBeDisabled();
  });

  test("restores a deleted note through Undo", async ({ page }) => {
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 undo note",
      "# Phase 2 undo note\n\nUndo body"
    );

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Note deleted")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 undo note\n\nUndo body"
    );
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });
});
