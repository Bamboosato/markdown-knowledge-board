import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

async function expectTooltipInsideViewport(
  button: Locator,
  interaction: "hover" | "focus"
) {
  if (interaction === "hover") {
    await button.hover();
  } else {
    await button.page().evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    for (let index = 0; index < 20; index += 1) {
      await button.page().keyboard.press("Tab");
      if (await button.evaluate((element) => element === document.activeElement)) {
        break;
      }
    }
    await expect(button).toBeFocused();
  }
  await expect
    .poll(() =>
      button.evaluate((element) => getComputedStyle(element, "::after").opacity)
    )
    .toBe("1");

  const bounds = await button.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    const buttonBox = element.getBoundingClientRect();
    const outerWidth =
      Number.parseFloat(style.width) +
      Number.parseFloat(style.paddingLeft) +
      Number.parseFloat(style.paddingRight);
    const transformX = new DOMMatrix(style.transform).e;
    const left =
      style.left !== "auto"
        ? buttonBox.left + Number.parseFloat(style.left) + transformX
        : buttonBox.right - Number.parseFloat(style.right) - outerWidth + transformX;
    return { left, right: left + outerWidth, viewportWidth: innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
}

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
    // Count saved cards only; the print surface repeats the current title.
    await expect(page.locator(".note-list").getByText("Ctrl shortcut note", { exact: true })).toHaveCount(1);
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
    await expect(page.locator(".note-list").getByText("Command shortcut note", { exact: true })).toHaveCount(1);
  });

  test("shows Windows shortcut tooltips on hover and keyboard focus", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { value: "Win32" });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const newNoteButton = page.getByRole("button", { name: /new note/i });
    await expect(newNoteButton).toHaveAttribute(
      "data-tooltip",
      "New Note (Alt+N)"
    );
    await expectTooltipInsideViewport(newNoteButton, "hover");

    await newNoteButton.click();
    const saveButton = page.locator(".editor-header .primary-button");
    await expect(saveButton).toHaveAttribute("data-tooltip", "Save (Ctrl+S)");
    await expectTooltipInsideViewport(saveButton, "focus");
  });

  test("shows macOS shortcut names in tooltips", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { value: "MacIntel" });
    });
    await page.goto("/");

    await expect(page.getByRole("button", { name: /new note/i })).toHaveAttribute(
      "data-tooltip",
      "New Note (Option+N)"
    );
    await expect(page.locator(".editor-header .primary-button")).toHaveAttribute(
      "data-tooltip",
      "Save (⌘S)"
    );
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
