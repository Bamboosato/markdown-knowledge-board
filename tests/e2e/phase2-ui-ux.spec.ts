import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

declare global {
  interface Window {
    __backupFileName?: string;
    __backupText?: string;
  }
}

async function createSavedNote(page: Page, title: string, body: string) {
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByLabel("Title").fill(title);
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
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 task note\n\n- [x] Verify preview task"
    );
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
