import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

declare global {
  interface Window {
    __backupFileName?: string;
    __backupText?: string;
    __viewTransitionCalls?: number;
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

async function clickAppMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: "Open application menu" }).click();
  await page.getByRole("menuitem", { name }).click();
}

async function clickNoteAction(page: Page, name: string) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name }).click();
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

    await clickAppMenuItem(page, "Backup All Notes");
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

    await clickAppMenuItem(page, "Backup All Notes");
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
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Open application menu" }).click();
    await expect(
      page.getByRole("menu", { name: "Application menu" }).locator(".backup-last-value")
    ).toHaveText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  test("does not show a backup result dialog when the save picker is canceled", async ({
    page,
  }) => {
    await mockBackupCancelPicker(page);
    await page.goto("/");

    await clickAppMenuItem(page, "Backup All Notes");

    await expect(
      page.getByRole("dialog", { name: /Backup/ })
    ).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("lastBackupAt"))).toBeNull();
  });

  test("shows the latest backup information inside the application menu", async ({ page }) => {
    await page.goto("/");

    const editorStatus = page.getByLabel("Editor status");
    await expect(editorStatus).toContainText("Status: No note");
    await expect(editorStatus).not.toContainText("Backup");
    await page.getByRole("button", { name: "Open application menu" }).click();
    const menu = page.getByRole("menu", { name: "Application menu" });
    await expect(menu.getByText("Last backup")).toBeVisible();
    await expect(menu.getByText("No backups yet")).toBeVisible();
    await expect(menu).toHaveCSS("width", "240px");
    const backupMenuItem = menu.getByRole("menuitem", {
      name: /Backup All Notes/,
    });
    await expect(backupMenuItem).toHaveCSS("align-items", "flex-start");
    const [backupIconBox, backupTitleBox] = await Promise.all([
      backupMenuItem.locator("svg").boundingBox(),
      backupMenuItem.getByText("Backup All Notes").boundingBox(),
    ]);
    expect(backupIconBox).not.toBeNull();
    expect(backupTitleBox).not.toBeNull();
    expect(Math.abs(backupIconBox!.y - backupTitleBox!.y)).toBeLessThanOrEqual(3);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /new note/i }).click();
    await expect(editorStatus).toContainText("Status: Draft");
    await expect(editorStatus.locator(".status-dot")).toHaveCSS(
      "background-color",
      "rgb(138, 138, 138)"
    );
    await page.getByLabel("Title").fill("Status colors");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(editorStatus).toContainText("Status: Saved");
    await expect(editorStatus.locator(".status-dot")).toHaveCSS(
      "background-color",
      "rgb(37, 99, 235)"
    );
    await page.getByLabel("Title").fill("Status colors changed");
    await expect(editorStatus).toContainText("Status: Unsaved");
    await expect(editorStatus.locator(".status-dot")).toHaveCSS(
      "background-color",
      "rgb(217, 119, 6)"
    );
  });

  test("places the sidebar and editor below the fixed header", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const headerBox = await page.locator(".editor-header").boundingBox();
    const sidebarBox = await page.locator(".sidebar").boundingBox();
    const editorBox = await page.locator(".editor").boundingBox();

    expect(headerBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(
      Math.abs(sidebarBox!.y - (headerBox!.y + headerBox!.height))
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(editorBox!.y - sidebarBox!.y)).toBeLessThanOrEqual(1);
  });

  test("separates backup actions from the Markdown import shortcut", async ({
    page,
  }) => {
    await page.goto("/");

    const menuButton = page.getByRole("button", {
      name: "Open application menu",
    });
    await menuButton.click();
    const menu = page.getByRole("menu", { name: "Application menu" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Backup All Notes" })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Import Backup" })
    ).toBeVisible();
    await expect(menu.getByText("Import Markdown")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    const markdownImport = page.getByRole("button", {
      name: "Import Markdown",
    });
    await expect(markdownImport).toHaveAttribute("data-tooltip", "Import Markdown");
    await expect(page.locator("#import-markdown")).toHaveAttribute(
      "accept",
      ".md,text/markdown"
    );
    await expect(page.locator("#import-backup")).toHaveAttribute(
      "accept",
      ".json,application/json"
    );
  });

  test("prioritizes Save and groups lower-frequency note actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const revertButton = page.getByRole("button", { name: "Revert changes" });
    const moreButton = page.getByRole("button", { name: "More actions" });
    await expect(revertButton).toHaveAttribute("data-tooltip", "Revert changes");
    await expect(moreButton).toHaveAttribute("data-tooltip", "More actions");
    await expect(revertButton).toBeDisabled();
    await expect(moreButton).toBeDisabled();

    await createSavedNote(page, "Action menu note", "# Action menu note");
    await expect(moreButton).toBeEnabled();
    await moreButton.click();
    const menu = page.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem", { name: "Export" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(moreButton).toBeFocused();
  });

  test("uses consistent borders and icon contrast across icon buttons", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const iconButtons = [
      page.getByRole("button", { name: "Open application menu" }),
      page.getByRole("button", { name: "Import Markdown" }),
      page.getByRole("button", { name: "Revert changes" }),
      page.getByRole("button", { name: "More actions" }),
      page.getByRole("button", { name: "Expand editor" }),
    ];
    for (const button of iconButtons) {
      await expect(button).toHaveAttribute("data-tooltip", /\S+/);
    }
    for (const name of [
      "Bold",
      "Italic",
      "Strike",
      "Code",
      "Bullet",
      "Task",
      "Quote",
      "Link",
    ]) {
      await expect(page.getByRole("button", { name })).toHaveAttribute(
        "data-tooltip",
        name
      );
    }
    await expect(page.getByRole("button", { name: "H1" })).not.toHaveAttribute(
      "data-tooltip"
    );
    const visualStyles = await Promise.all(
      iconButtons.map((button) =>
        button.evaluate((element) => {
          const buttonStyle = getComputedStyle(element);
          const icon = element.querySelector("svg");
          if (!icon) {
            throw new Error("Icon not found");
          }
          return {
            borderColor: buttonStyle.borderTopColor,
            borderWidth: buttonStyle.borderTopWidth,
            color: buttonStyle.color,
            iconStrokeWidth: getComputedStyle(icon).strokeWidth,
          };
        })
      )
    );

    expect(new Set(visualStyles.map((style) => style.borderColor)).size).toBe(1);
    expect(new Set(visualStyles.map((style) => style.borderWidth))).toEqual(
      new Set(["1px"])
    );
    expect(new Set(visualStyles.map((style) => style.color)).size).toBe(1);
    expect(new Set(visualStyles.map((style) => style.iconStrokeWidth))).toEqual(
      new Set(["2px"])
    );
    await iconButtons[0].hover();
    await expect
      .poll(() =>
        iconButtons[0].evaluate(
          (element) => getComputedStyle(element, "::after").opacity
        )
      )
      .toBe("1");
    await expect(page.getByRole("button", { name: "Revert changes" })).toHaveCSS(
      "opacity",
      "1"
    );
  });

  test("keeps editor controls in a slim single-row sticky header", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const header = page.locator(".editor-header");
    const headerBox = await header.boundingBox();
    const buttonBoxes = await header.locator("button").evaluateAll((buttons) =>
      buttons
        .filter((button) => getComputedStyle(button).display !== "none")
        .map((button) => {
          const box = button.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        })
    );

    expect(headerBox).not.toBeNull();
    expect(headerBox!.height).toBeLessThanOrEqual(56);
    expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe(
      "sticky"
    );
    expect(Math.max(...buttonBoxes.map((box) => box.top))).toBeLessThanOrEqual(
      Math.min(...buttonBoxes.map((box) => box.bottom))
    );
  });

  test("keeps horizontal scrolling out of the page, sidebar, and header", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    const actions = page.locator(".editor-actions");
    await expect(actions).toHaveCSS("overflow-x", "visible");
    await expect(actions).toHaveCSS("overflow-y", "visible");

    await createSavedNote(
      page,
      "A-very-long-note-title-without-breakable-spaces-that-must-stay-inside-the-sidebar",
      "# Header overflow note"
    );

    const overflowMetrics = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      if (!sidebar) {
        throw new Error("Sidebar not found");
      }
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        sidebarClientWidth: sidebar.clientWidth,
        sidebarScrollWidth: sidebar.scrollWidth,
        overflowingSidebarChildren: [...sidebar.querySelectorAll<HTMLElement>("*")]
          .filter((element) => element.getBoundingClientRect().right > sidebar.getBoundingClientRect().right)
          .map((element) => ({
            className: element.className,
            right: element.getBoundingClientRect().right,
          })),
      };
    });
    expect(overflowMetrics.documentScrollWidth).toBeLessThanOrEqual(
      overflowMetrics.documentClientWidth
    );
    expect(
      overflowMetrics.sidebarScrollWidth,
      JSON.stringify(overflowMetrics.overflowingSidebarChildren)
    ).toBeLessThanOrEqual(overflowMetrics.sidebarClientWidth);

    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu", { name: "More actions" })).toBeVisible();
  });

  test("expands the Body editor below the fixed header with a view transition", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__viewTransitionCalls = 0;
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: (update: () => void) => {
          window.__viewTransitionCalls = (window.__viewTransitionCalls ?? 0) + 1;
          update();
          return {};
        },
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(
      page,
      "Expanded editor note",
      Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n")
    );

    const body = page.getByLabel("Body");
    await body.fill(`Unsaved body\n${await body.inputValue()}`);
    await body.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error("Body textarea not found");
      }
      element.setSelectionRange(3, 8);
      element.scrollTop = 120;
    });

    await page.getByRole("button", { name: "Expand editor" }).click();
    await expect(page.locator(".app")).toHaveClass(/editor-expanded/);
    await expect(page.locator(".sidebar")).toHaveCSS("visibility", "hidden");
    await expect(page.getByText("Status: Unsaved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore editor" })).toBeVisible();

    const expandedBounds = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>(".app-workspace");
      const editorBody = document.querySelector<HTMLElement>(".editor-body.is-expanded");
      if (!workspace || !editorBody) {
        throw new Error("Expanded editor layout not found");
      }
      const workspaceBox = workspace.getBoundingClientRect();
      const editorBox = editorBody.getBoundingClientRect();
      const textarea = document.querySelector<HTMLTextAreaElement>("#body");
      return {
        workspace: {
          top: workspaceBox.top,
          right: workspaceBox.right,
          bottom: workspaceBox.bottom,
          left: workspaceBox.left,
        },
        editor: {
          top: editorBox.top,
          right: editorBox.right,
          bottom: editorBox.bottom,
          left: editorBox.left,
        },
        selectionStart: textarea?.selectionStart,
        selectionEnd: textarea?.selectionEnd,
        scrollTop: textarea?.scrollTop,
        transitionCalls: window.__viewTransitionCalls,
      };
    });
    expect(expandedBounds.editor).toEqual(expandedBounds.workspace);
    expect(expandedBounds.selectionStart).toBe(3);
    expect(expandedBounds.selectionEnd).toBe(8);
    expect(expandedBounds.scrollTop).toBeGreaterThan(0);
    expect(expandedBounds.transitionCalls).toBe(1);

    await page.keyboard.press("Escape");
    await expect(page.locator(".app")).not.toHaveClass(/editor-expanded/);
    await expect(page.locator(".sidebar")).toHaveCSS("visibility", "visible");
    await expect(page.getByRole("button", { name: "Expand editor" })).toBeVisible();
    await expect(body).toHaveValue(/^Unsaved body/);
    await expect.poll(() => page.evaluate(() => window.__viewTransitionCalls)).toBe(2);
  });

  test("expands immediately when the View Transitions API is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: undefined,
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await page.getByRole("button", { name: "Expand editor" }).click();
    await expect(page.locator(".app")).toHaveClass(/editor-expanded/);
    await expect(page.getByRole("button", { name: "Restore editor" })).toBeVisible();
  });

  test("uses an immediate mobile expansion when reduced motion is requested", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.__viewTransitionCalls = 0;
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: (update: () => void) => {
          window.__viewTransitionCalls = (window.__viewTransitionCalls ?? 0) + 1;
          update();
          return {};
        },
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();

    await page.getByRole("button", { name: "Expand editor" }).click();
    await expect(page.locator(".app")).toHaveClass(/editor-expanded/);
    const verticalBounds = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".editor-header");
      const editorBody = document.querySelector<HTMLElement>(".editor-body.is-expanded");
      if (!header || !editorBody) {
        throw new Error("Expanded mobile editor layout not found");
      }
      return {
        headerBottom: header.getBoundingClientRect().bottom,
        editorTop: editorBody.getBoundingClientRect().top,
        editorBottom: editorBody.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
        transitionCalls: window.__viewTransitionCalls,
      };
    });
    expect(verticalBounds.editorTop).toBeCloseTo(verticalBounds.headerBottom, 0);
    expect(verticalBounds.editorBottom).toBeCloseTo(verticalBounds.viewportHeight, 0);
    expect(verticalBounds.transitionCalls).toBe(0);
  });

  test("keeps document scrolling locked while Preview owns its overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Stable preview", "# Stable preview\n\nShort body");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".preview-panel .preview-label")).toHaveCount(0);
    const preview = page.locator(".mdPreview-scroll");
    await expect(preview).toHaveCSS("overflow-y", "auto");
    const desktopOverflow = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflowY,
      body: getComputedStyle(document.body).overflowY,
      root: getComputedStyle(document.querySelector<HTMLElement>("#root")!).overflowY,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
    }));
    expect(desktopOverflow.html).toBe("hidden");
    expect(desktopOverflow.body).toBe("hidden");
    expect(desktopOverflow.root).toBe("hidden");
    expect(desktopOverflow.documentScrollHeight).toBeLessThanOrEqual(
      desktopOverflow.documentClientHeight
    );

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflowY,
      body: getComputedStyle(document.body).overflowY,
      root: getComputedStyle(document.querySelector<HTMLElement>("#root")!).overflowY,
    }));
    expect(mobileOverflow).toEqual({
      html: "visible",
      body: "visible",
      root: "visible",
    });
  });

  test("keeps Edit and Preview positions only within the current note", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const longBody = Array.from(
      { length: 80 },
      (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}`
    ).join("\n\n");
    await createSavedNote(page, "Scroll position A", longBody);

    const edit = page.getByLabel("Body");
    const editPosition = await edit.evaluate((element) => {
      element.scrollTop = 240;
      return element.scrollTop;
    });
    expect(editPosition).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.locator(".mdPreview-scroll");
    const previewPosition = await preview.evaluate((element) => {
      element.scrollTop = 320;
      element.dataset.scrollInstance = "preserved";
      return element.scrollTop;
    });
    expect(previewPosition).toBeGreaterThan(0);
    const previewAnchor = await preview.evaluate((element) => {
      const rootTop = element.getBoundingClientRect().top;
      const children = Array.from(element.children);
      const index = children.findIndex(
        (child) => child.getBoundingClientRect().bottom > rootTop
      );
      return {
        index,
        offset: children[index]?.getBoundingClientRect().top ?? 0,
      };
    });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.poll(() => edit.evaluate((element) => element.scrollTop)).toBe(
      editPosition
    );

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect
      .poll(() => preview.evaluate((element) => element.scrollTop))
      .toBe(previewPosition);
    await expect(preview).toHaveAttribute("data-scroll-instance", "preserved");
    const restoredPreviewAnchor = await preview.evaluate((element) => {
      const rootTop = element.getBoundingClientRect().top;
      const children = Array.from(element.children);
      const index = children.findIndex(
        (child) => child.getBoundingClientRect().bottom > rootTop
      );
      return {
        index,
        offset: children[index]?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(restoredPreviewAnchor.index).toBe(previewAnchor.index);
    expect(restoredPreviewAnchor.offset).toBeCloseTo(previewAnchor.offset, 0);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await preview.evaluate((element) => {
      const firstChild = element.firstElementChild;
      if (firstChild instanceof HTMLElement) {
        firstChild.style.paddingBottom = "96px";
      }
    });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const relaidOutPreviewAnchor = await preview.evaluate((element) => {
      const rootTop = element.getBoundingClientRect().top;
      const children = Array.from(element.children);
      const index = children.findIndex(
        (child) => child.getBoundingClientRect().bottom > rootTop
      );
      return {
        index,
        offset: children[index]?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(relaidOutPreviewAnchor.index).toBe(previewAnchor.index);
    expect(relaidOutPreviewAnchor.offset).toBeCloseTo(previewAnchor.offset, 0);

    await createSavedNote(page, "Scroll position B", longBody);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect
      .poll(() => page.locator(".mdPreview-scroll").evaluate((element) => element.scrollTop))
      .toBe(0);
  });

  test("centers text in every button", async ({ page }) => {
    await page.goto("/");

    const textAlignValues = await page.locator("button").evaluateAll((buttons) =>
      [...new Set(buttons.map((button) => getComputedStyle(button).textAlign))]
    );

    expect(textAlignValues).toEqual(["center"]);
  });

  test("uses the same restrained corner radius for tabs and inputs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();

    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCSS(
      "border-radius",
      "8px"
    );
    await expect(page.getByRole("button", { name: "Preview" })).toHaveCSS(
      "border-radius",
      "8px"
    );
    await expect(page.getByRole("button", { name: "Slides" })).toHaveCSS(
      "border-radius",
      "8px"
    );
    for (const name of ["Edit", "Preview", "Slides"]) {
      const tab = page.getByRole("button", { name, exact: true });
      await expect(tab).toHaveCSS("min-width", "80px");
      await expect(tab).toHaveCSS("justify-content", "center");
    }
    const titleLabel = page.locator(".metadata-field .label", {
      hasText: "Title",
    });
    await expect(titleLabel).toHaveCSS("font-size", "13.6px");
    await expect(titleLabel).toHaveCSS("font-weight", "600");
    await expect(titleLabel).toHaveCSS("color", "rgb(102, 102, 102)");
    const labelColumnWidths = await page.evaluate(() => ({
      metadata: getComputedStyle(
        document.querySelector<HTMLElement>(".metadata-field")!
      ).gridTemplateColumns.split(" ")[0],
      body: getComputedStyle(
        document.querySelector<HTMLElement>(".body-header")!
      ).gridTemplateColumns.split(" ")[0],
    }));
    expect(labelColumnWidths).toEqual({ metadata: "56px", body: "56px" });
  });

  test("uses shared size tiers for primary, compact, and editor controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    const newNote = page.getByRole("button", { name: /new note/i });
    const importMarkdown = page.getByRole("button", { name: "Import Markdown" });
    await expect(newNote).toHaveCSS("height", "40px");
    await expect(importMarkdown).toHaveCSS("height", "40px");
    await expect(importMarkdown.locator("svg")).toHaveCSS("width", "18px");

    await newNote.click();
    for (const name of ["Edit", "Preview", "Slides"]) {
      await expect(
        page.getByRole("button", { name, exact: true })
      ).toHaveCSS("height", "40px");
    }
    const moreActions = page.getByRole("button", { name: "More actions" });
    await expect(moreActions).toHaveCSS("height", "36px");
    await expect(moreActions.locator("svg")).toHaveCSS("width", "18px");
    const bold = page.getByRole("button", { name: "Bold" });
    await expect(bold).toHaveCSS("height", "30px");
    await expect(bold.locator("svg")).toHaveCSS("width", "15px");
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
    await clickAppMenuItem(page, "Backup All Notes");
    await expect(
      page.getByRole("dialog", { name: "Backup Complete" })
    ).toBeVisible();
    const backupText = await page.evaluate(() => window.__backupText ?? "");
    await page.getByRole("button", { name: "Close" }).click();

    await page.setInputFiles("#import-backup", {
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

    await page.setInputFiles("#import-markdown", [
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
    await expect(page.getByText("Status: Unsaved")).toBeVisible();

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
    const suggestionBox = await suggestions.boundingBox();
    const tagSuggestBox = await page.locator(".metadata-field .tag-suggest").boundingBox();
    expect(suggestionBox).not.toBeNull();
    expect(tagSuggestBox).not.toBeNull();
    expect(Math.abs(suggestionBox!.x - tagSuggestBox!.x)).toBeLessThanOrEqual(1);
    expect(suggestionBox!.width).toBeCloseTo(
      Math.min(360, tagSuggestBox!.width),
      0
    );
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
    const selectedTagChip = page.locator(".tag-chip", { hasText: "UI/UX" });
    await expect(selectedTagChip).toBeVisible();
    await expect(selectedTagChip).toHaveCSS("border-radius", "8px");
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
    await page.keyboard.press("Escape");
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

    await expect(
      toolbar.getByRole("button", { name: "Bold" }).locator(".lucide-bold")
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Italic" }).locator(".lucide-italic")
    ).toBeVisible();
    await expect(
      toolbar
        .getByRole("button", { name: "Strike" })
        .locator(".lucide-strikethrough")
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Code" }).locator(".lucide-code")
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Bullet" }).locator(".lucide-list")
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Task" }).locator(".lucide-list-todo")
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Quote" }).locator(".lucide-quote")
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Link" }).locator(".lucide-link")
    ).toBeVisible();
    await expect(toolbar.getByText("Bold", { exact: true })).toHaveCount(0);
    await expect(toolbar.getByText("Italic", { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(toolbar).toHaveCSS("overflow-x", "visible");
    await expect(toolbar).toHaveCSS("overflow-y", "visible");
    const toolbarOverflow = await toolbar.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(toolbarOverflow.scrollWidth).toBeLessThanOrEqual(
      toolbarOverflow.clientWidth
    );
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
    expect(Math.abs(mobileToolbarBox!.x - mobileBodyLabelBox!.x)).toBeLessThan(2);

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
      toolbarBox!.x + toolbarBox!.width + 1
    );
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
    await expect(page.getByText("Status: Unsaved")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revert changes" })
    ).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revert changes" }).click();

    await expect(page.getByLabel("Title")).toHaveValue("Phase 2 revert note");
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 revert note\n\nOriginal body"
    );
    await expect(page.getByText("Status: Saved")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revert changes" })
    ).toBeDisabled();
  });

  test("restores a deleted note through Undo", async ({ page }) => {
    await page.goto("/");

    await createSavedNote(
      page,
      "Phase 2 undo note",
      "# Phase 2 undo note\n\nUndo body"
    );

    await clickNoteAction(page, "Delete");
    const deleteDialog = page.getByRole("dialog", { name: "Delete note?" });
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toContainText("Phase 2 undo note");
    await expect(deleteDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteDialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 undo note\n\nUndo body"
    );

    await clickNoteAction(page, "Delete");
    await deleteDialog.press("Escape");
    await expect(deleteDialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();

    await clickNoteAction(page, "Delete");
    await deleteDialog.getByRole("button", { name: "Delete Note" }).click();

    await expect(page.getByText("Note deleted")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 2 undo note\n\nUndo body"
    );
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });
});
