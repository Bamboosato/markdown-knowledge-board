import { expect, test } from "@playwright/test";
import { expectBodyEditorValue } from "./body-editor";

test.describe("Phase 1 mobile workflow", () => {
  test("keeps draft, save, preview, and unsaved transitions reachable", async ({
    page,
  }) => {
    await page.goto("/");

    const notesLabelBox = await page.locator(".section-title", { hasText: "Notes" }).boundingBox();
    const noteCountBox = await page.locator(".note-count").boundingBox();
    expect(notesLabelBox).not.toBeNull();
    expect(noteCountBox).not.toBeNull();
    expect(
      Math.abs(
        noteCountBox!.y + noteCountBox!.height / 2 -
          (notesLabelBox!.y + notesLabelBox!.height / 2)
      )
    ).toBeLessThan(1);
    await expect(page.locator(".note-count")).toHaveText("(0)");
    await expect(page.locator(".note-count")).toHaveAttribute(
      "aria-label",
      "0 notes"
    );

    await page.getByRole("button", { name: /new note/i }).click();
    await expect(
      page.getByRole("heading", { name: "Markdown Knowledge Board" })
    ).toBeVisible();
    await expect(page.getByText("Status: Draft")).toBeVisible();

    const [titleBox, statusBox, notesBox, saveBox] = await Promise.all([
      page.getByRole("heading", { name: "Markdown Knowledge Board" }).boundingBox(),
      page.getByLabel("Editor status").boundingBox(),
      page.getByRole("button", { name: "Notes" }).boundingBox(),
      page.getByRole("button", { name: /^Save$/ }).boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(notesBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    const titleCenterY = titleBox!.y + titleBox!.height / 2;
    const statusCenterY = statusBox!.y + statusBox!.height / 2;
    const saveCenterY = saveBox!.y + saveBox!.height / 2;
    const notesCenterY = notesBox!.y + notesBox!.height / 2;
    expect(Math.abs(titleCenterY - statusCenterY)).toBeLessThanOrEqual(1);
    expect(Math.abs(notesCenterY - saveCenterY)).toBeLessThanOrEqual(1);
    expect(statusBox!.x).toBeGreaterThan(titleBox!.x);
    expect(notesBox!.x).toBeLessThan(saveBox!.x);
    expect(notesBox!.y).toBeGreaterThan(titleBox!.y);
    expect(saveBox!.width).toBeLessThan(140);
    const notesLink = page.getByRole("button", { name: "Notes" });
    await expect(notesLink).toHaveText("＜ NOTES");
    await expect(notesLink).toHaveCSS("border-top-width", "0px");
    await expect(notesLink).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(notesLink).toHaveCSS("align-items", "center");
    await expect(notesLink).toHaveCSS("font-size", "14.4px");
    await expect(notesLink).toHaveCSS("font-weight", "600");
    await expect(notesLink).toHaveCSS("letter-spacing", "0.864px");
    await expect(notesLink).toHaveCSS("line-height", "14.4px");
    const headerBounds = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".editor-header")!;
      const titleRow = document.querySelector<HTMLElement>(".editor-title-row")!;
      const actions = document.querySelector<HTMLElement>(".editor-actions")!;
      const headerBox = header.getBoundingClientRect();
      return [titleRow, actions].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          leftOverflow: headerBox.left - box.left,
          rightOverflow: box.right - headerBox.right,
        };
      });
    });
    for (const bounds of headerBounds) {
      expect(bounds.leftOverflow).toBeLessThanOrEqual(0);
      expect(bounds.rightOverflow).toBeLessThanOrEqual(0);
    }

    await page.getByLabel("Title").fill("Phase 1 mobile note");
    await page
      .getByLabel("Body")
      .fill("# Phase 1\n\n- [ ] Verify mobile editor");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { name: "Phase 1" })).toBeVisible();

    await page.getByRole("button", { name: "Notes" }).click();
    await expect(
      page.getByRole("button", { name: /new note/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 1 mobile note/ })
    ).toBeVisible();

    await page.getByRole("button", { name: /Phase 1 mobile note/ }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Body")).toBeVisible();
    await page.getByLabel("Body").fill("# Phase 1\n\nChanged but not saved");
    await page.getByRole("button", { name: "Notes" }).click();

    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save and Continue" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Discard and Continue" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expectBodyEditorValue(page.getByLabel("Body"),
      "# Phase 1\n\nChanged but not saved"
    );

    await page.getByRole("button", { name: "Notes" }).click();
    await page.getByRole("button", { name: "Discard and Continue" }).click();
    await expect(
      page.getByRole("button", { name: /new note/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /Phase 1 mobile note/ }).click();
    await expectBodyEditorValue(page.getByLabel("Body"),
      "# Phase 1\n\n- [ ] Verify mobile editor"
    );
  });

  test("keeps the desktop title, status, and save action on one row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();

    const [titleBox, statusBox, saveBox] = await Promise.all([
      page.getByRole("heading", { name: "Markdown Knowledge Board" }).boundingBox(),
      page.getByLabel("Editor status").boundingBox(),
      page.getByRole("button", { name: /^Save$/ }).boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(saveBox).not.toBeNull();

    const centers = [titleBox!, statusBox!, saveBox!].map(
      (box) => box.y + box.height / 2
    );
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    expect(statusBox!.x).toBeGreaterThan(titleBox!.x);
    await expect(page.getByRole("button", { name: "Notes" })).toBeHidden();
  });

  test("shows deliberate press and keyboard focus feedback without the Android tap highlight", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();

    const body = page.getByLabel("Body");
    await body.fill("Draft remains unchanged while the editor expands");
    const expandButton = page.getByRole("button", { name: "Expand editor" });

    await expect
      .poll(() =>
        expandButton.evaluate((element) =>
          getComputedStyle(element).getPropertyValue("-webkit-tap-highlight-color")
        )
      )
      .toBe("rgba(0, 0, 0, 0)");

    await expandButton.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(expandButton).toBeFocused();
    await expect(expandButton).toHaveCSS("outline-color", "rgb(127, 179, 255)");
    await expect(expandButton).toHaveCSS("outline-style", "solid");
    await expect(expandButton).toHaveCSS("outline-width", "3px");

    const buttonBox = await expandButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    await page.mouse.move(
      buttonBox!.x + buttonBox!.width / 2,
      buttonBox!.y + buttonBox!.height / 2
    );
    await page.mouse.down();
    await expect(expandButton).toHaveCSS("background-color", "rgb(222, 222, 222)");
    await expect(expandButton).toHaveCSS("border-color", "rgb(115, 115, 115)");
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await expect(page.locator(".app")).not.toHaveClass(/editor-expanded/);

    await expandButton.click();
    const restoreButton = page.getByRole("button", { name: "Restore editor" });
    await expect(page.locator(".app")).toHaveClass(/editor-expanded/);
    await expect(restoreButton).toHaveAttribute("aria-pressed", "true");
    await expectBodyEditorValue(body, "Draft remains unchanged while the editor expands");

    await restoreButton.click();
    await expect(page.locator(".app")).not.toHaveClass(/editor-expanded/);
    await expect(expandButton).toHaveAttribute("aria-pressed", "false");
    await expectBodyEditorValue(body, "Draft remains unchanged while the editor expands");
  });

  test("restores the notes list when leaving an expanded mobile editor", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();
    await page.getByRole("button", { name: "Expand editor" }).click();
    await expect(page.locator(".app")).toHaveClass(/editor-expanded/);

    await page.getByRole("button", { name: "Notes" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".app")).toHaveClass(/editor-expanded/);
    await expect(page.getByRole("button", { name: "Restore editor" })).toBeVisible();

    await page.getByRole("button", { name: "Notes" }).click();
    await page.getByRole("button", { name: "Discard and Continue" }).click();

    await expect(page.locator(".app")).not.toHaveClass(/editor-expanded/);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.getByRole("button", { name: /new note/i })).toBeVisible();
    await expect(page.getByRole("main")).toBeHidden();
  });
});
