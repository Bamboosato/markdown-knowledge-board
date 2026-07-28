import { expect, test } from "@playwright/test";

test.describe("keyboard shortcuts", () => {
  test("creates with Alt+N and saves with Ctrl+S while an editor field is focused", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("Editor status")).toContainText("Status: No note");

    await page.keyboard.press("Alt+KeyN");
    await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
    await page.getByLabel("Title").fill("Ctrl shortcut note");
    await page.getByLabel("Body").fill("Saved from the keyboard");

    await page.keyboard.press("Control+KeyS");

    await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
    await expect(page.getByText("Ctrl shortcut note", { exact: true })).toHaveCount(1);
  });

  test("supports Command+S and exposes the platform bindings", async ({ page }) => {
    await page.goto("/");

    const newNoteButton = page.getByRole("button", { name: /new note/i });
    const saveButton = page.locator(".editor-header .primary-button");
    await expect(newNoteButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+N"
    );
    await expect(saveButton).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+S Meta+S"
    );

    await newNoteButton.click();
    await page.getByLabel("Title").fill("Command shortcut note");
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
    await expect(page.getByText("Command shortcut note", { exact: true })).toHaveCount(1);
  });

  test("uses the existing unsaved transition when Alt+N is pressed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Editor status")).toContainText("Status: No note");
    await page.keyboard.press("Alt+KeyN");
    await page.getByLabel("Title").fill("Unsaved shortcut note");

    await page.keyboard.press("Alt+KeyN");

    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });
    await expect(dialog).toContainText("create a new note");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Unsaved shortcut note");

    await page.keyboard.press("Alt+KeyN");
    await dialog.getByRole("button", { name: "Discard and Continue" }).click();
    await expect(page.getByLabel("Editor status")).toContainText("Status: Draft");
    await expect(page.getByLabel("Title")).toHaveValue("");
  });

  test("prevents browser defaults but ignores repeated shortcut events", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Editor status")).toContainText("Status: No note");

    const defaultPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "n",
        altKey: true,
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });

    expect(defaultPrevented).toBe(true);
    await expect(page.getByLabel("Editor status")).toContainText("Status: No note");
  });
});
