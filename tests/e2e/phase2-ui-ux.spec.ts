import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  expectBodyEditorValue,
  readBodyEditorValue,
} from "./body-editor";

declare global {
  interface Window {
    __backupFileName?: string;
    __backupText?: string;
    __viewTransitionCalls?: number;
    __downloadText?: string;
    __downloadFileName?: string;
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

async function seedSavedNotes(
  page: Page,
  notes: Array<{
    id: string;
    title: string;
    body: string;
    tags: string[];
    updatedAt: number;
  }>
) {
  await page.goto("/");
  await page.evaluate(async (items) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("markdown-knowledge-board", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("notes", "readwrite");
    const store = transaction.objectStore("notes");
    for (const item of items) {
      store.put(item);
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, notes);
  await page.reload();
}

async function dispatchFileDrag(
  page: Page,
  eventType: "dragenter" | "dragover" | "dragleave" | "drop",
  files: Array<{ name: string; mimeType: string; content: string }>
) {
  return page.locator('.editor-body:not([hidden])').evaluate(
    (element, payload) => {
      const dataTransfer = new DataTransfer();
      for (const file of payload.files) {
        dataTransfer.items.add(
          new File([file.content], file.name, { type: file.mimeType })
        );
      }
      const event = new DragEvent(payload.eventType, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { eventType, files }
  );
}

async function expectResultValue(dialog: Locator, label: string, value: string) {
  await expect(dialog.locator(".result-summary div", { hasText: label }).locator("dd")).toHaveText(
    value
  );
}

async function clickAppMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: "Open application menu" }).click();
  await page
    .getByRole("menu", { name: "Application menu" })
    .getByRole("menuitem", { name: "Local Data", exact: true })
    .click();
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

async function inputValues(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value)
  );
}

async function mockMarkdownDownload(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        void blob.text().then((text) => {
          window.__downloadText = text;
        });
        return "blob:markdown-download";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => {},
    });
    HTMLAnchorElement.prototype.click = function () {
      window.__downloadFileName = this.download;
    };
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
    await page.getByRole("button", { name: "Selected note actions" }).click();
    await page.getByRole("menuitem", { name: "Pin to top" }).click();

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
    expect(backup.notes[0].pinnedAt).toEqual(expect.any(Number));
    expect(backup.notes[0].markdown).not.toContain("pinnedAt:");
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Open application menu" }).click();
    await page.getByRole("menuitem", { name: "Local Data", exact: true }).click();
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

  test("pins notes in a stable group and restores pinned cards after delete Undo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedSavedNotes(page, [
      {
        id: "older-note",
        title: "Older note",
        body: "# Older note",
        tags: [],
        updatedAt: 1000,
      },
      {
        id: "middle-note",
        title: "Middle note",
        body: "# Middle note",
        tags: [],
        updatedAt: 2000,
      },
      {
        id: "newest-note",
        title: "Newest note",
        body: "# Newest note",
        tags: [],
        updatedAt: 3000,
      },
    ]);

    const cardTitles = page.locator(".note-item:not(.empty) .note-title");
    await expect(cardTitles).toHaveText([
      "Newest note",
      "Middle note",
      "Older note",
    ]);

    await page.getByRole("button", { name: "Open note: Older note" }).click();
    await page.getByRole("button", { name: "Selected note actions" }).click();
    const olderMenu = page.getByRole("menu", { name: "Actions for Older note" });
    await expect(olderMenu.getByRole("menuitem")).toHaveText([
      "Pin to top",
      "Delete",
    ]);
    await olderMenu.getByRole("menuitem", { name: "Pin to top" }).click();
    await expect(cardTitles).toHaveText([
      "Older note",
      "Newest note",
      "Middle note",
    ]);
    await expect(
      page.getByRole("button", { name: "Pinned note actions: Older note" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Body").fill("# Older note\n\nUpdated while pinned");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(
      page.getByRole("button", { name: "Pinned note actions: Older note" })
    ).toBeVisible();
    await expect(cardTitles).toHaveText([
      "Older note",
      "Newest note",
      "Middle note",
    ]);

    await page.getByRole("button", { name: "Open note: Middle note" }).click();
    await page.getByRole("button", { name: "Selected note actions" }).click();
    await page.getByRole("menuitem", { name: "Pin to top" }).click();
    await expect(cardTitles).toHaveText([
      "Middle note",
      "Older note",
      "Newest note",
    ]);

    await page.getByRole("button", { name: "Open note: Newest note" }).click();
    await page
      .getByRole("button", { name: "Pinned note actions: Middle note" })
      .click();
    const middleMenu = page.getByRole("menu", { name: "Actions for Middle note" });
    await expect(middleMenu.getByRole("menuitem")).toHaveText([
      "Unpin",
      "Delete",
    ]);
    await middleMenu.getByRole("menuitem", { name: "Unpin" }).click();
    await expect(cardTitles).toHaveText([
      "Older note",
      "Newest note",
      "Middle note",
    ]);
    await expect(
      page.getByRole("button", { name: "Open note: Middle note" })
    ).toBeFocused();

    await page.reload();
    await expect(cardTitles).toHaveText([
      "Older note",
      "Newest note",
      "Middle note",
    ]);
    const olderPinButton = page.getByRole("button", {
      name: "Pinned note actions: Older note",
    });
    await olderPinButton.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete note?" });
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(olderPinButton).toBeFocused();

    await olderPinButton.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await deleteDialog.getByRole("button", { name: "Delete Note" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(cardTitles).toHaveText([
      "Older note",
      "Newest note",
      "Middle note",
    ]);
    await expect(olderPinButton).toBeVisible();
  });

  test("shows the latest backup information inside the application menu", async ({ page }) => {
    await page.goto("/");

    const editorStatus = page.getByLabel("Editor status");
    await expect(editorStatus).toContainText("Status: No note");
    await expect(editorStatus).not.toContainText("Backup");
    await page.getByRole("button", { name: "Open application menu" }).click();
    const menu = page.getByRole("menu", { name: "Application menu" });
    await menu.getByRole("menuitem", { name: "Local Data", exact: true }).click();
    await expect(menu.getByText("Local Data", { exact: true })).toBeVisible();
    await expect(menu.getByText("Last local backup")).toBeVisible();
    await expect(menu.getByText("No backups yet")).toBeVisible();
    await expect(menu).toHaveCSS("width", "280px");
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
      menu.getByRole("menuitem", { name: "Local Data", exact: true })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Backup All Notes" })
    ).toHaveCount(0);
    await menu
      .getByRole("menuitem", { name: "Local Data", exact: true })
      .click();
    await expect(
      menu.getByRole("menuitem", { name: "Backup All Notes" })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Import Backup" })
    ).toBeVisible();
    await expect(menu.getByText("Import Markdown")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    const markdownImport = page.getByRole("button", {
      name: "Import Markdown",
    });
    await expect(markdownImport).toHaveAttribute("data-tooltip", "Import Markdown");
    await expect(page.locator("#import-markdown")).toHaveAttribute(
      "accept",
      ".md,.markdown,.txt,text/markdown,text/plain"
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
    await expect(menu.getByRole("menuitem", { name: "Metadata" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Export" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(moreButton).toBeFocused();
  });

  test("keeps quiet icon buttons transparent with consistent icon contrast", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();

    const quietIconButtons = [
      page.getByRole("button", { name: "Open application menu" }),
      page.getByRole("button", { name: "Import Markdown" }),
      page.getByRole("button", { name: "Revert changes" }),
      page.getByRole("button", { name: "More actions" }),
    ];
    const iconButtons = [
      ...quietIconButtons,
      page.getByRole("button", { name: "Expand editor" }),
    ];
    for (const button of iconButtons) {
      await expect(button).toHaveAttribute("data-tooltip", /\S+/);
    }
    for (const name of ["Format", "Paragraph", "Insert"]) {
      await expect(page.getByRole("button", { name })).toHaveAttribute(
        "aria-haspopup",
        "menu"
      );
      await expect(page.getByRole("button", { name })).not.toHaveAttribute(
        "data-tooltip"
      );
    }
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

    expect(
      new Set(
        visualStyles
          .slice(0, quietIconButtons.length)
          .map((style) => style.borderColor)
      )
    ).toEqual(new Set(["rgba(0, 0, 0, 0)"]));
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

  test("keeps edge button tooltips inside a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await createSavedNote(page, "Tooltip bounds", "# Tooltip bounds");

    for (const name of ["Open application menu", "More actions"]) {
      const button = page.getByRole("button", { name });
      await button.hover();
      const bounds = await button.evaluate((element) => {
        const style = getComputedStyle(element, "::after");
        const buttonBox = element.getBoundingClientRect();
        const outerWidth = Number.parseFloat(style.width);
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
      "# Header overflow note",
      [
        "a-very-long-tag-without-breakable-spaces-that-must-be-truncated",
        "mobile",
        "design",
      ]
    );

    const noteCard = page.locator(".note-item:not(.empty)");
    const noteTitle = noteCard.locator(".note-title");
    const noteTags = noteCard.locator(".note-tags");
    const longTag = noteCard.locator(".note-tag").first();
    await expect(noteTitle).toHaveAttribute(
      "title",
      "A-very-long-note-title-without-breakable-spaces-that-must-stay-inside-the-sidebar"
    );
    await expect(noteTitle).toHaveCSS("white-space", "nowrap");
    await expect(noteTitle).toHaveCSS("text-overflow", "ellipsis");
    await expect(noteTags).toHaveCSS("flex-wrap", "nowrap");
    await expect(noteTags).toHaveCSS("overflow-x", "hidden");
    await expect(noteCard.locator(".note-tag")).toHaveCount(3);
    await expect(longTag).toHaveAttribute(
      "title",
      "a-very-long-tag-without-breakable-spaces-that-must-be-truncated"
    );
    await expect(longTag).toHaveCSS("border-radius", "4px");
    await expect(longTag).toHaveCSS("text-overflow", "ellipsis");
    const truncationMetrics = await noteCard.evaluate((card) => {
      const title = card.querySelector<HTMLElement>(".note-title")!;
      const tag = card.querySelector<HTMLElement>(".note-tag")!;
      return {
        titleIsTruncated: title.scrollWidth > title.clientWidth,
        tagIsTruncated: tag.scrollWidth > tag.clientWidth,
      };
    });
    expect(truncationMetrics.titleIsTruncated).toBe(true);
    expect(truncationMetrics.tagIsTruncated).toBe(true);

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
    await body.fill(`Unsaved body\n${await readBodyEditorValue(body)}`);
    await body.evaluate((element) => {
      const editor = element as HTMLElement & {
        setSelectionRange?: (start: number, end: number) => void;
      };
      if (!editor.setSelectionRange) {
        throw new Error("Body editor selection bridge not found");
      }
      editor.setSelectionRange(3, 8);
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
    await expectBodyEditorValue(body, /^Unsaved body/);
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
    await page.getByRole("button", { name: /new note/i }).click();

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
    const editLineHeight = await edit.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).lineHeight)
    );

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
    await expect
      .poll(async () =>
        Math.abs(
          (await edit.evaluate((element) => element.scrollTop)) - editPosition
        )
      )
      .toBeLessThan(editLineHeight);

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
    const format = page.getByRole("button", { name: "Format" });
    await expect(format).toHaveCSS("height", "30px");
    await format.click();
    const bold = page.getByRole("menuitem", { name: "Bold" });
    await expect(bold).toHaveCSS("min-height", "32px");
    await expect(bold.locator("svg")).toHaveCSS("width", "15px");
  });

  test("aligns the compact Filter tool with the note count and responsive card gutters", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Gutter note", "Gutter body");
    await page.getByRole("button", { name: "Preview", exact: true }).click();

    const notesHeading = page.locator(".notes-heading");
    const noteCount = notesHeading.locator(".note-count");
    await expect(noteCount).toHaveText("(1)");
    await expect(noteCount).toHaveAttribute("aria-label", "1 note");
    const filterButton = page.getByRole("button", {
      name: "Filter",
      exact: true,
    });
    await expect(filterButton).toHaveCSS("height", "32px");
    await expect(filterButton).toHaveCSS("font-size", "14px");
    await expect(filterButton).toHaveCSS("font-weight", "500");
    await expect(filterButton).toHaveCSS("border-top-width", "0px");
    await expect(filterButton).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
    await filterButton.hover();
    await expect(filterButton).toHaveCSS(
      "background-color",
      "rgb(241, 241, 241)"
    );
    await expect(filterButton).toHaveCSS("border-radius", "8px");
    await expect(filterButton).toHaveCSS(
      "box-shadow",
      "rgb(199, 199, 199) 0px 0px 0px 1px inset"
    );
    await page.mouse.move(1000, 700);
    await page.getByRole("button", { name: "Import Markdown" }).focus();
    await page.keyboard.press("Tab");
    await expect(filterButton).toBeFocused();
    await expect(filterButton).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
    await expect(filterButton).toHaveCSS("box-shadow", "none");
    await expect(filterButton).toHaveCSS("outline-width", "3px");
    const filterIcon = filterButton.locator(".filter-button-icon");
    await expect(filterIcon).toHaveCSS("width", "16px");
    await expect(filterIcon).toHaveCSS("height", "16px");
    await expect(filterIcon).toHaveAttribute("aria-hidden", "true");
    await expect(filterIcon).toHaveAttribute("stroke-width", "2");
    const filterInternalGeometry = await filterButton.evaluate((element) => {
      const icon = element.querySelector<SVGElement>(".filter-button-icon")!;
      const label = element.querySelector<HTMLElement>(".filter-button-label")!;
      const iconBox = icon.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      return {
        gap: labelBox.left - iconBox.right,
        centerDifference: Math.abs(
          iconBox.top + iconBox.height / 2 -
            (labelBox.top + labelBox.height / 2)
        ),
        iconColor: getComputedStyle(icon).color,
        labelColor: getComputedStyle(label).color,
      };
    });
    expect(filterInternalGeometry.gap).toBeCloseTo(6, 0);
    expect(filterInternalGeometry.centerDifference).toBeLessThan(1);
    expect(filterInternalGeometry.iconColor).toBe(filterInternalGeometry.labelColor);

    const desktopHeaderGeometry = await page
      .locator(".sidebar")
      .evaluate((sidebar) => {
        const header = sidebar.querySelector<HTMLElement>(".notes-header")!;
        const card = sidebar.querySelector<HTMLElement>(
          ".note-item:not(.empty)"
        )!;
        const centers = [
          header.querySelector<HTMLElement>(".section-title")!,
          header.querySelector<HTMLElement>(".note-count")!,
          header.querySelector<HTMLElement>(".filter-button")!,
        ].map((item) => {
          const box = item.getBoundingClientRect();
          return box.top + box.height / 2;
        });
        const headerBox = header.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        return {
          centerDifference: Math.max(...centers) - Math.min(...centers),
          leftEdgeDifference: Math.abs(headerBox.left - cardBox.left),
          rightEdgeDifference: Math.abs(headerBox.right - cardBox.right),
        };
      });
    expect(desktopHeaderGeometry.centerDifference).toBeLessThan(1);
    expect(desktopHeaderGeometry.leftEdgeDifference).toBeLessThanOrEqual(1);
    expect(desktopHeaderGeometry.rightEdgeDifference).toBeLessThanOrEqual(1);

    for (const selector of [".sidebar", ".editor", ".editor-header"]) {
      await expect(page.locator(selector)).toHaveCSS("padding-left", "16px");
      await expect(page.locator(selector)).toHaveCSS("padding-right", "16px");
    }
    await expect(page.locator(".preview-panel")).toHaveCSS("padding", "18px");
    await expect(page.locator(".note-list")).toHaveCSS("padding-right", "8px");

    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByRole("button", { name: "Notes" }).click();
    for (const selector of [".sidebar", ".editor", ".editor-header"]) {
      await expect(page.locator(selector)).toHaveCSS("padding-left", "12px");
      await expect(page.locator(selector)).toHaveCSS("padding-right", "12px");
    }
    const mobileGeometry = await page.locator(".sidebar").evaluate((sidebar) => {
      const noteList = sidebar.querySelector<HTMLElement>(".note-list")!;
      const notesHeader = sidebar.querySelector<HTMLElement>(".notes-header")!;
      const card = sidebar.querySelector<HTMLElement>(
        ".note-item:not(.empty)"
      )!;
      const headerBox = notesHeader.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      return {
        headerOverflow: notesHeader.scrollWidth > notesHeader.clientWidth,
        leftEdgeDifference: Math.abs(headerBox.left - cardBox.left),
        rightEdgeDifference: Math.abs(headerBox.right - cardBox.right),
        scrollbarToEdge:
          sidebar.getBoundingClientRect().right -
          noteList.getBoundingClientRect().right,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(mobileGeometry.headerOverflow).toBe(false);
    expect(mobileGeometry.leftEdgeDifference).toBeLessThanOrEqual(1);
    expect(mobileGeometry.rightEdgeDifference).toBeLessThanOrEqual(1);
    expect(mobileGeometry.scrollbarToEdge).toBeCloseTo(4, 0);
    expect(mobileGeometry.horizontalOverflow).toBe(false);
  });

  test("keeps an overflowing note list scrollbar visible and scrollable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await seedSavedNotes(
      page,
      Array.from({ length: 20 }, (_, index) => ({
        id: `scrollbar-note-${index}`,
        title: `Scrollbar note ${index + 1}`,
        body: `# Scrollbar note ${index + 1}`,
        tags: [],
        updatedAt: index + 1,
      }))
    );

    const noteList = page.locator(".note-list");
    const scrollbarState = await noteList.evaluate((list) => {
      const thumbStyle = getComputedStyle(list, "::-webkit-scrollbar-thumb");
      const trackStyle = getComputedStyle(list, "::-webkit-scrollbar-track");
      const hasVerticalOverflow = list.scrollHeight > list.clientHeight;
      list.scrollTop = list.scrollHeight;
      return {
        hasVerticalOverflow,
        scrollTop: list.scrollTop,
        thumbBackground: thumbStyle.backgroundColor,
        thumbBorderWidth: thumbStyle.borderTopWidth,
        thumbRadius: thumbStyle.borderRadius,
        trackBackground: trackStyle.backgroundColor,
      };
    });
    expect(scrollbarState).toEqual({
      hasVerticalOverflow: true,
      scrollTop: expect.any(Number),
      thumbBackground: "rgb(133, 133, 133)",
      thumbBorderWidth: "2px",
      thumbRadius: "999px",
      trackBackground: "rgba(0, 0, 0, 0)",
    });
    expect(scrollbarState.scrollTop).toBeGreaterThan(0);
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
    await expect(page.locator(".db-error")).toHaveCount(0);
  });

  test("imports Markdown and text files dropped on the Body", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Drop target", "# Drop target");

    const validFiles = [
      {
        name: "source-document.markdown",
        mimeType: "text/markdown",
        content: "# Internal Heading\n\nImported body",
      },
      {
        name: "plain-note.txt",
        mimeType: "text/plain",
        content: "Plain text imported as a note.",
      },
      {
        name: "frontmatter-name.md",
        mimeType: "text/markdown",
        content: "---\ntitle: Explicit Title\n---\n# Another heading",
      },
    ];
    const body = page.locator('.editor-body:not([hidden])');

    expect(await dispatchFileDrag(page, "dragenter", validFiles)).toBe(true);
    await expect(body).toHaveClass(/is-drag-active/);
    expect(await dispatchFileDrag(page, "dragleave", validFiles)).toBe(true);
    await expect(body).not.toHaveClass(/is-drag-active/);

    const dropWasPrevented = await dispatchFileDrag(page, "drop", [
      ...validFiles,
      {
        name: "empty.txt",
        mimeType: "text/plain",
        content: "",
      },
      {
        name: "unsupported.pdf",
        mimeType: "application/pdf",
        content: "not a supported file",
      },
    ]);
    expect(dropWasPrevented).toBe(true);

    const choiceDialog = page.getByRole("dialog", {
      name: "Import Markdown Files",
    });
    await expect(choiceDialog).toBeVisible();
    await expect(
      choiceDialog.getByRole("button", { name: "Replace Current Note Body" })
    ).toBeDisabled();
    await choiceDialog
      .getByRole("button", { name: "Add as New Notes" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Import Complete" });
    await expect(dialog).toBeVisible();
    await expectResultValue(dialog, "Added", "3");
    await expectResultValue(dialog, "Failed", "2");
    await dialog.getByText("Failed files").click();
    await expect(dialog.getByText("empty.txt")).toBeVisible();
    await expect(dialog.getByText("unsupported.pdf")).toBeVisible();
    await expect(body).not.toHaveClass(/is-drag-active/);
    await expect(page.locator(".db-error")).toHaveCount(0);
    await expect(page.locator(".note-title", { hasText: "source-document" })).toBeVisible();
    await expect(page.locator(".note-title", { hasText: "plain-note" })).toBeVisible();
    await expect(page.locator(".note-title", { hasText: "Explicit Title" })).toBeVisible();
    await expect(page.locator(".note-title", { hasText: "Internal Heading" })).toHaveCount(0);
  });

  test("imports Markdown dropped on Preview without replacing the current note", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Preview drop target", "Original preview body");
    await page.getByRole("button", { name: "Preview", exact: true }).click();

    const previewPanel = page.locator(".preview-panel:not([hidden])");
    const files = [
      {
        name: "preview-import.md",
        mimeType: "text/markdown",
        content: "# Imported from Preview",
      },
    ];
    expect(await dispatchFileDrag(page, "dragenter", files)).toBe(true);
    await expect(previewPanel).toHaveClass(/is-drag-active/);
    expect(await dispatchFileDrag(page, "dragleave", files)).toBe(true);
    await expect(previewPanel).not.toHaveClass(/is-drag-active/);

    expect(await dispatchFileDrag(page, "drop", files)).toBe(true);
    const choiceDialog = page.getByRole("dialog", {
      name: "Import Markdown File",
    });
    await expect(choiceDialog).toBeVisible();
    await expect(
      choiceDialog.getByRole("button", { name: "Cancel" })
    ).toBeFocused();
    await choiceDialog
      .getByRole("button", { name: "Add as New Note" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Import Complete" });
    await expect(dialog).toBeVisible();
    await expectResultValue(dialog, "Added", "1");
    await expect(previewPanel).not.toHaveClass(/is-drag-active/);
    await expect(previewPanel).toContainText("Original preview body");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(
      page.locator(".note-title", { hasText: "preview-import" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expectBodyEditorValue(page.getByLabel("Body"), "Original preview body");
  });

  test("keeps a Draft when its Body file import choice is canceled", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();
    await page.getByLabel("Title").fill("Unsaved drop source");
    await page.getByLabel("Body").fill("Keep this draft");

    await dispatchFileDrag(page, "drop", [
      {
        name: "cancelled.md",
        mimeType: "text/markdown",
        content: "# Must not import",
      },
    ]);
    await page
      .getByRole("dialog", { name: "Import Markdown File" })
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect(page.getByLabel("Title")).toHaveValue("Unsaved drop source");
    await expectBodyEditorValue(page.getByLabel("Body"), "Keep this draft");
    await expect(
      page.getByRole("dialog", { name: "Unsaved Changes" })
    ).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Import Complete" })).toHaveCount(0);
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
    await expectBodyEditorValue(page.getByLabel("Body"),
      "# Phase 2 task note\n\n- [x] Verify preview task"
    );
  });

  test("builds an accessible H1-H3 table of contents and scrolls the desktop preview", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const filler = Array.from(
      { length: 32 },
      (_, index) => `Paragraph ${index + 1}: preview table of contents content.`
    ).join("\n\n");
    await createSavedNote(
      page,
      "TOC desktop",
      `# Overview\n\n## Duplicate\n\n### Details\n\n#### Excluded level\n\n\`\`\`md\n## Excluded code\n\`\`\`\n\n${filler}\n\n## Duplicate`
    );

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Table of contents" });
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.focus();
    await expect(trigger).toBeFocused();
    await expect
      .poll(() =>
        page
          .locator(".preview-toc-trigger")
          .evaluate((element) => getComputedStyle(element, "::after").opacity)
      )
      .toBe("1");
    const tooltipStyle = await page.locator(".preview-toc-trigger").evaluate((element) => {
      const tooltip = getComputedStyle(element, "::after");
      return {
        content: tooltip.content,
        opacity: tooltip.opacity,
        width: Number.parseFloat(tooltip.width),
        whiteSpace: tooltip.whiteSpace,
      };
    });
    expect(tooltipStyle.content).toContain("Table of contents");
    expect(tooltipStyle.opacity).toBe("1");
    expect(tooltipStyle.width).toBeGreaterThan(80);
    expect(tooltipStyle.whiteSpace).toBe("nowrap");
    await page.keyboard.press("Enter");
    const toc = page.getByRole("navigation", { name: "Table of contents" });
    await expect(toc).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Heading level 1: Overview" })).toBeFocused();
    await expect(toc.getByText("Excluded level")).toHaveCount(0);
    await expect(toc.getByText("Excluded code")).toHaveCount(0);
    await expect(toc.getByRole("button", { name: /Heading level 2: Duplicate/ })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Heading level 3: Details" })).toHaveAttribute(
      "data-level",
      "3"
    );
    await expect(page.getByRole("button", { name: "Heading level 1: Overview" })).toHaveCSS(
      "text-align",
      "left"
    );
    const tocIndents = await toc.locator(".preview-toc-item").evaluateAll((items) =>
      items.slice(0, 3).map((item) => Number.parseFloat(getComputedStyle(item).paddingLeft))
    );
    expect(tocIndents[0]).toBeLessThan(tocIndents[1]);
    expect(tocIndents[1]).toBeLessThan(tocIndents[2]);

    const documentScrollBefore = await page.evaluate(() => window.scrollY);
    await toc.getByRole("button", { name: "Heading level 2: Duplicate" }).last().click();
    await expect(toc).toHaveCount(0);
    await expect
      .poll(() => page.locator(".mdPreview-scroll").evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(documentScrollBefore);
    await expect(page.locator(".mdPreview h2", { hasText: "Duplicate" }).last()).toBeFocused();
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });

  test("closes the table of contents on Escape, outside click, and tab changes", async ({
    page,
  }) => {
    await page.goto("/");
    await createSavedNote(page, "TOC close behavior", "# First\n\n## Second");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Table of contents" });

    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Table of contents" })).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator(".preview-panel").click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole("navigation", { name: "Table of contents" })).toHaveCount(0);

    await trigger.click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Table of contents" })).toHaveCount(0);
  });

  test("disables an empty table of contents and scrolls the mobile document", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "No TOC headings", "Plain paragraph only");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByRole("button", { name: "Table of contents" })).toBeDisabled();
    await expect(page.locator(".preview-toc-trigger")).toHaveAttribute("data-tooltip", "No headings");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const filler = Array.from({ length: 40 }, (_, index) => `Mobile paragraph ${index + 1}.`).join(
      "\n\n"
    );
    await page.getByLabel("Body").fill(`# Mobile start\n\n${filler}\n\n## Mobile target`);
    await page.getByRole("button", { name: /^Save$/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const mobileTocTrigger = page.getByRole("button", { name: "Table of contents" });
    await page.evaluate(() => window.scrollTo(0, 72));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const stickyLayering = await mobileTocTrigger.evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>(".editor-header");
      const headerRect = header?.getBoundingClientRect();
      const pointX = buttonRect.left + buttonRect.width / 2;
      const pointY = Math.max(1, Math.min(buttonRect.bottom - 1, (headerRect?.bottom ?? 1) - 1));
      const topElement = document.elementFromPoint(pointX, pointY);
      return {
        overlapsHeader: Boolean(headerRect && buttonRect.top < headerRect.bottom),
        coveredByHeader: Boolean(header && topElement && header.contains(topElement)),
      };
    });
    expect(stickyLayering).toEqual({ overlapsHeader: true, coveredByHeader: true });
    await page.evaluate(() => window.scrollTo(0, 0));

    await mobileTocTrigger.click();
    await expect(page.getByRole("navigation", { name: "Table of contents" })).toHaveCSS(
      "transition-duration",
      "0s"
    );
    await page.getByRole("button", { name: "Heading level 2: Mobile target" }).click();

    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await expect(page.getByRole("navigation", { name: "Table of contents" })).toHaveCount(0);
    const alignment = await page.locator(".mdPreview h2").evaluate((heading) => {
      const header = document.querySelector<HTMLElement>(".editor-header");
      return {
        headingTop: heading.getBoundingClientRect().top,
        headerBottom: header?.getBoundingClientRect().bottom ?? 0,
      };
    });
    expect(alignment.headingTop).toBeGreaterThanOrEqual(alignment.headerBottom - 1);
  });

  test("opens a matching relative Markdown link in the linked note preview", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(
      page,
      "phase2-auth-cloud-backup-architecture",
      "# Linked architecture preview\n\nDestination content"
    );
    await createSavedNote(
      page,
      "Link source",
      "[基本設計](./phase2-auth-cloud-backup-architecture.md?view=preview#top)"
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("link", { name: "基本設計" }).click();

    await expect(
      page.getByRole("heading", { name: "Linked architecture preview" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByRole("button", { name: "Notes" })).toBeVisible();
  });

  test("reveals an offscreen linked note card on desktop and after returning to mobile Notes", async ({
    page,
  }) => {
    const fillerNotes = Array.from({ length: 18 }, (_, index) => ({
      id: `filler-${index}`,
      title: `Filler note ${index + 1}`,
      body: `# Filler note ${index + 1}`,
      tags: [],
      updatedAt: 100 + index,
    }));
    await page.setViewportSize({ width: 1280, height: 700 });
    await seedSavedNotes(page, [
      {
        id: "scroll-target",
        title: "Scroll target",
        body: "# Scroll target preview",
        tags: [],
        updatedAt: 1,
      },
      ...fillerNotes,
      {
        id: "scroll-source",
        title: "Scroll source",
        body: "[Open target](./Scroll%20target.md)",
        tags: [],
        updatedAt: 1000,
      },
    ]);

    const noteList = page.locator(".note-list");
    const targetCard = page.getByRole("button", {
      name: "Open note: Scroll target",
    });
    await page.getByRole("button", { name: "Open note: Scroll source" }).click();
    await expect(noteList).toHaveJSProperty("scrollTop", 0);
    await page.getByRole("link", { name: "Open target" }).click();
    await expect(targetCard).toHaveAttribute("aria-current", "true");
    await expect
      .poll(async () =>
        noteList.evaluate((list, targetId) => {
          const target = Array.from(
            list.querySelectorAll<HTMLElement>(".note-card-select")
          ).find((button) => button.dataset.noteId === targetId);
          if (!target) {
            return { visible: false, scrollTop: list.scrollTop };
          }
          const listRect = list.getBoundingClientRect();
          const targetRect = target.closest(".note-item")!.getBoundingClientRect();
          return {
            visible:
              targetRect.top >= listRect.top - 1 &&
              targetRect.bottom <= listRect.bottom + 1,
            scrollTop: list.scrollTop,
          };
        }, "scroll-target")
      )
      .toMatchObject({ visible: true });
    expect(await noteList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("button", { name: "Open note: Scroll source" }).click();
    await page.getByRole("link", { name: "Open target" }).click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.getByRole("button", { name: "Notes" }).click();
    await expect
      .poll(async () =>
        noteList.evaluate((list, targetId) => {
          const target = Array.from(
            list.querySelectorAll<HTMLElement>(".note-card-select")
          ).find((button) => button.dataset.noteId === targetId);
          if (!target) {
            return false;
          }
          const listRect = list.getBoundingClientRect();
          const targetRect = target.closest(".note-item")!.getBoundingClientRect();
          return (
            targetRect.top >= listRect.top - 1 &&
            targetRect.bottom <= listRect.bottom + 1
          );
        }, "scroll-target")
      )
      .toBe(true);
    expect(await noteList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("keeps filters when a linked note card is hidden and reveals it after Clear", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Filtered target", "# Filtered target preview");
    await createSavedNote(
      page,
      "Filtered source",
      "[Open filtered target](./Filtered%20target.md)"
    );

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Filter notes" });
    await dialog.getByRole("searchbox", { name: "Search" }).fill("source");
    await dialog.getByRole("button", { name: "Apply Filters" }).click();
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("link", { name: "Open filtered target" }).click();

    await expect(page.getByRole("status")).toHaveText(
      "Linked note is hidden by the current filter: Filtered target"
    );
    await expect(page.locator(".note-count")).toHaveText("(1 of 2)");
    await expect(
      page.getByRole("button", { name: "Open note: Filtered target" })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open note: Filtered target" })
    ).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("keeps the current preview when a note link is missing or ambiguous", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Duplicate", "# First duplicate");
    await createSavedNote(page, "Duplicate", "# Second duplicate");
    await createSavedNote(
      page,
      "Link diagnostics",
      [
        "# Link diagnostics preview",
        "",
        "[Missing](./Missing.md)",
        "[Duplicate](../notes/Duplicate.markdown)",
        "[External](https://example.com/reference.md)",
      ].join("\n")
    );
    await page.getByRole("button", { name: "Preview" }).click();
    const currentUrl = page.url();

    await page.getByRole("link", { name: "Missing" }).click();
    await expect(page.getByRole("status")).toHaveText("Note not found: Missing");
    expect(page.url()).toBe(currentUrl);
    await expect(
      page.getByRole("heading", { name: "Link diagnostics preview" })
    ).toBeVisible();

    await page.getByRole("link", { name: "Duplicate" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Multiple notes found: Duplicate"
    );
    expect(page.url()).toBe(currentUrl);
    await expect(page.getByRole("link", { name: "External" })).toHaveAttribute(
      "href",
      "https://example.com/reference.md"
    );
  });

  test("honors unsaved confirmation before following a note preview link", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Linked target", "# Confirmed destination");
    await createSavedNote(
      page,
      "Unsaved link source",
      "# Source preview\n\n[Target](./Linked%20target.md)"
    );
    await page.getByLabel("Body").fill(
      "# Source preview\n\nUnsaved text\n\n[Target](./Linked%20target.md)"
    );
    await page.getByRole("button", { name: "Preview" }).click();

    await page.getByRole("link", { name: "Target" }).click();
    await expect(page.getByRole("dialog", { name: "Unsaved Changes" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.locator(".mdPreview").getByText("Unsaved text", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Confirmed destination" })).toHaveCount(0);

    await page.getByRole("link", { name: "Target" }).click();
    await page.getByRole("button", { name: "Discard and Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirmed destination" })
    ).toBeVisible();
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
    await expect(selectedTagChip).toHaveCSS("border-radius", "4px");
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
    await expect(page.locator(".note-count")).toHaveText("(2)");
    await expect(page.locator(".note-count")).toHaveAttribute(
      "aria-label",
      "2 notes"
    );
    await expect(
      page.getByRole("listbox", { name: "Filter tag suggestions" })
    ).toHaveCount(0);

    const inactiveFilterButton = page.getByRole("button", {
      name: "Filter",
      exact: true,
    });
    const inactiveFilterGeometry = await inactiveFilterButton.evaluate(
      (element) => {
        const buttonBox = element.getBoundingClientRect();
        const iconBox = element
          .querySelector<SVGElement>(".filter-button-icon")!
          .getBoundingClientRect();
        const labelBox = element
          .querySelector<HTMLElement>(".filter-button-label")!
          .getBoundingClientRect();
        return {
          iconLeftOffset: iconBox.left - buttonBox.left,
          iconCenterOffset:
            iconBox.top + iconBox.height / 2 -
            (buttonBox.top + buttonBox.height / 2),
          labelCenterOffset:
            labelBox.top + labelBox.height / 2 -
            (buttonBox.top + buttonBox.height / 2),
        };
      }
    );
    await inactiveFilterButton.click();
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
    const filterTagChip = dialog.locator(".tag-chip", { hasText: "UI/UX" });
    await expect(filterTagChip).toBeVisible();
    await expect(filterTagChip).toHaveCSS("border-radius", "4px");
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

    const activeFilterButton = page.getByRole("button", {
      name: "Filter · 3",
    });
    const clearFilterButton = page.getByRole("button", {
      name: "Clear",
      exact: true,
    });
    await expect(activeFilterButton).toBeVisible();
    await expect(activeFilterButton).toHaveCSS("height", "32px");
    await expect(activeFilterButton).toHaveCSS("font-size", "14px");
    await expect(activeFilterButton).toHaveCSS("font-weight", "500");
    await expect(activeFilterButton).toHaveCSS("border-top-width", "0px");
    await expect(activeFilterButton).toHaveCSS("border-radius", "999px");
    await expect(activeFilterButton).toHaveCSS(
      "background-color",
      "rgb(238, 243, 248)",
    );
    const activeFilterGeometry = await activeFilterButton.evaluate((element) => {
      const buttonBox = element.getBoundingClientRect();
      const iconBox = element
        .querySelector<SVGElement>(".filter-button-icon")!
        .getBoundingClientRect();
      const labelBox = element
        .querySelector<HTMLElement>(".filter-button-label")!
        .getBoundingClientRect();
      const clearBox = element.parentElement!
        .querySelector<HTMLElement>(".filter-clear-button")!
        .getBoundingClientRect();
      return {
        iconLeftOffset: iconBox.left - buttonBox.left,
        iconCenterOffset:
          iconBox.top + iconBox.height / 2 -
          (buttonBox.top + buttonBox.height / 2),
        labelCenterOffset:
          labelBox.top + labelBox.height / 2 -
          (buttonBox.top + buttonBox.height / 2),
        labelGap: labelBox.left - iconBox.right,
        clearGap: clearBox.left - buttonBox.right,
      };
    });
    expect(activeFilterGeometry.iconLeftOffset).toBeCloseTo(
      inactiveFilterGeometry.iconLeftOffset,
      0
    );
    expect(activeFilterGeometry.iconCenterOffset).toBeCloseTo(
      inactiveFilterGeometry.iconCenterOffset,
      0
    );
    expect(activeFilterGeometry.labelCenterOffset).toBeCloseTo(
      inactiveFilterGeometry.labelCenterOffset,
      0
    );
    expect(activeFilterGeometry.labelGap).toBeCloseTo(6, 0);
    expect(activeFilterGeometry.clearGap).toBeCloseTo(8, 0);
    await expect(clearFilterButton).toHaveCSS("height", "32px");
    await expect(clearFilterButton).toHaveCSS("font-size", "14px");
    await expect(clearFilterButton).toHaveCSS("font-weight", "500");
    await expect(clearFilterButton).toHaveCSS("border-top-width", "0px");
    const appliedHeaderCenterAlignment = await page
      .locator(".notes-header")
      .evaluate((element) => {
        const centers = [
          element.querySelector<HTMLElement>(".section-title")!,
          element.querySelector<HTMLElement>(".note-count")!,
          element.querySelector<HTMLElement>(".filter-button")!,
          element.querySelector<HTMLElement>(".filter-clear-button")!,
        ].map((item) => {
          const box = item.getBoundingClientRect();
          return box.top + box.height / 2;
        });
        return Math.max(...centers) - Math.min(...centers);
      });
    expect(appliedHeaderCenterAlignment).toBeLessThan(1);
    await expect(page.locator(".note-count")).toHaveText("(1 of 2)");
    await expect(page.locator(".note-count")).toHaveAttribute(
      "aria-label",
      "1 of 2 notes"
    );
    await expect(
      page.getByRole("button", { name: /Phase 2 filter match/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 2 filter other/ })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    const restoredFilterButton = page.getByRole("button", {
      name: "Filter",
      exact: true,
    });
    await expect(restoredFilterButton).toBeVisible();
    await expect(restoredFilterButton).toBeFocused();
    await expect(page.locator(".note-count")).toHaveText("(2)");
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

    await page.getByRole("button", { name: "Filter · 3" }).click();
    await dialog.getByRole("button", { name: "Clear Filters" }).click();
    await expect(dialog.getByText("2 notes", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Filter · 3" })).toBeVisible();

    await page.getByRole("button", { name: "Filter · 3" }).click();
    await searchInput.fill("missing");
    await dialog.getByRole("button", { name: "Apply Filters" }).click();
    await expect(
      page.getByText("No notes match your filters.")
    ).toBeVisible();
    await expect(page.locator(".note-count")).toHaveText("(0 of 2)");
    await expect(page.locator(".note-count")).toHaveAttribute(
      "aria-label",
      "0 of 2 notes"
    );
    await page.getByRole("button", { name: "Clear Filters" }).click();
    await expect(restoredFilterButton).toBeVisible();
    await expect(restoredFilterButton).toBeFocused();
    await expect(page.locator(".note-count")).toHaveText("(2)");
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

    const formatTrigger = toolbar.getByRole("button", { name: "Format" });
    const paragraphTrigger = toolbar.getByRole("button", {
      name: "Paragraph",
    });
    const insertTrigger = toolbar.getByRole("button", { name: "Insert" });
    await expect(formatTrigger).toBeVisible();
    await expect(paragraphTrigger).toBeVisible();
    await expect(insertTrigger).toBeVisible();

    await formatTrigger.click();
    const formatMenu = page.getByRole("menu", { name: "Format" });
    await expect(formatMenu).toBeVisible();
    await expect(
      formatMenu.getByRole("menuitem", { name: "Bold" }).locator(".lucide-bold")
    ).toBeVisible();
    await expect(
      formatMenu
        .getByRole("menuitem", { name: "Highlight" })
        .locator(".lucide-highlighter")
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(formatMenu).toHaveCount(0);

    await paragraphTrigger.click();
    const paragraphMenu = page.getByRole("menu", { name: "Paragraph" });
    await expect(
      paragraphMenu.getByRole("menuitem", { name: "Heading 3" })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await insertTrigger.click();
    const insertMenu = page.getByRole("menu", { name: "Insert" });
    await expect(
      insertMenu.getByRole("menuitem", { name: "Table" }).locator(".lucide-table-2")
    ).toBeVisible();
    await expect(
      insertMenu
        .getByRole("menuitem", { name: "Code block" })
        .locator("svg")
    ).toBeVisible();
    await page.keyboard.press("Escape");

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

    const revertButton = page.getByRole("button", { name: "Revert changes" });
    await revertButton.click();
    const revertDialog = page.getByRole("dialog", { name: "Revert changes?" });
    await expect(revertDialog).toContainText(
      "Your unsaved changes will be discarded"
    );
    const cancel = revertDialog.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(page.getByLabel("Title")).toHaveValue("Changed title");
    await expectBodyEditorValue(page.getByLabel("Body"),
      "# Changed title\n\nChanged body"
    );
    await expect(revertButton).toBeFocused();

    await revertButton.click();
    await revertDialog.getByRole("button", { name: "Revert Changes" }).click();

    await expect(page.getByLabel("Title")).toHaveValue("Phase 2 revert note");
    await expectBodyEditorValue(page.getByLabel("Body"),
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
    await expectBodyEditorValue(page.getByLabel("Body"),
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
    await expectBodyEditorValue(page.getByLabel("Body"),
      "# Phase 2 undo note\n\nUndo body"
    );
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });

  test("edits custom metadata locally and validates protected keys", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Metadata note", "# Metadata", ["design"]);

    await clickNoteAction(page, "Metadata");
    const dialog = page.getByRole("dialog", { name: "Metadata" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Read-only", { exact: true })).toHaveCount(1);
    await expect(dialog.locator(".metadata-managed-row")).toHaveCount(4);
    await expect(dialog.locator(".metadata-managed-row dd").first()).toHaveCSS(
      "display",
      "flex"
    );
    await expect(dialog.locator(".metadata-managed-row dt")).toHaveText([
      "id",
      "title",
      "tags",
      "updatedAt",
    ]);
    await expect(dialog.locator(".metadata-managed-row", { hasText: "title" })).toContainText(
      "Metadata note"
    );
    await expect(dialog.locator(".metadata-managed-row", { hasText: "tags" })).toContainText(
      "design"
    );

    const buttonHeights = await dialog.evaluate((element) => {
      const height = (selector: string) =>
        element.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
          .height ?? 0;
      return {
        add: height(".metadata-add-button"),
        cancel: height(".metadata-dialog-footer .secondary-button"),
        apply: height(".metadata-dialog-footer .primary-button"),
      };
    });
    expect(buttonHeights).toEqual({ add: 40, cancel: 40, apply: 40 });

    await dialog.getByRole("button", { name: "Add custom field" }).click();
    const deleteButton = dialog.getByRole("button", {
      name: "Delete custom field 1",
    });
    await expect(deleteButton).toHaveAttribute("data-tooltip", "Delete field");
    await expect(deleteButton).toHaveCSS("width", "40px");
    await expect(deleteButton).toHaveCSS("height", "40px");
    await expect(deleteButton).toHaveCSS("border-radius", "8px");
    const deleteIconSize = await deleteButton.locator("svg").evaluate((icon) => {
      const rect = icon.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(deleteIconSize).toEqual({ width: 18, height: 18 });
    await deleteButton.hover();
    await expect(deleteButton).toHaveCSS("color", "rgb(180, 35, 24)");
    const key = dialog.locator(".metadata-custom-key").first();
    const value = dialog.locator(".metadata-custom-value").first();
    await key.fill("title");
    await value.fill("Shadow title");
    await expect(dialog.getByText("title is managed by the application.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();

    await key.fill("author");
    await value.fill("Takeo");
    await dialog.getByRole("button", { name: "Add custom field" }).click();
    await dialog.locator(".metadata-custom-key").nth(1).fill("author");
    await dialog.locator(".metadata-custom-value").nth(1).fill("reviewed");
    await expect(dialog.getByText("Key must be unique.").first()).toBeVisible();
    await dialog.locator(".metadata-custom-key").nth(1).fill("status");
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();

    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Status: Unsaved")).toBeVisible();
    await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();

    await clickNoteAction(page, "Metadata");
    await dialog.locator(".metadata-custom-value").first().fill("Changed locally");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const discardDialog = page.getByRole("alertdialog", {
      name: "Discard metadata changes?",
    });
    await expect(discardDialog).toBeVisible();
    await expect(discardDialog).toHaveCSS("padding", "20px");
    await expect(discardDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    const discardGeometry = await discardDialog.evaluate((element) => {
      const container = element.closest<HTMLElement>(".metadata-dialog");
      return {
        width: container?.getBoundingClientRect().width ?? 0,
        actionsJustify: getComputedStyle(
          element.querySelector<HTMLElement>(".dialog-actions")!
        ).justifyContent,
      };
    });
    expect(discardGeometry).toEqual({ width: 420, actionsJustify: "flex-end" });
    await discardDialog.getByRole("button", { name: "Discard" }).click();

    await clickNoteAction(page, "Metadata");
    await expect(dialog.locator(".metadata-custom-value").first()).toHaveValue("Takeo");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("button", { name: /^Save$/ }).click();
    await page.reload();
    await page.locator(".note-item", { hasText: "Metadata note" }).click();
    await clickNoteAction(page, "Metadata");
    expect(await inputValues(dialog.locator(".metadata-custom-key"))).toEqual([
      "author",
      "status",
    ]);
    expect(await inputValues(dialog.locator(".metadata-custom-value"))).toEqual([
      "Takeo",
      "reviewed",
    ]);
  });

  test("keeps the metadata dialog operable inside a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto("/");
    await createSavedNote(page, "Mobile metadata", "# Mobile metadata");
    await clickNoteAction(page, "Metadata");

    const dialog = page.getByRole("dialog", { name: "Metadata" });
    for (let index = 0; index < 8; index += 1) {
      await dialog.getByRole("button", { name: "Add custom field" }).click();
      await dialog.locator(".metadata-custom-key").nth(index).fill(`key_${index}`);
      await dialog.locator(".metadata-custom-value").nth(index).fill(`value_${index}`);
    }

    const geometry = await dialog.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(".metadata-dialog-body");
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        bodyOverflowY: body ? getComputedStyle(body).overflowY : "",
        bodyScrollable: body ? body.scrollHeight > body.clientHeight : false,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.bodyOverflowY).toBe("auto");
    expect(geometry.bodyScrollable).toBe(true);
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeVisible();
    await page.keyboard.press("Control+Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Status: Unsaved")).toBeVisible();
  });

  test("round-trips imported custom metadata in canonical export order", async ({
    page,
  }) => {
    await mockMarkdownDownload(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await createSavedNote(page, "Import target", "# Import target");

    await dispatchFileDrag(page, "drop", [
      {
        name: "metadata-roundtrip.md",
        mimeType: "text/markdown",
        content: [
          "---",
          "id: imported-metadata-note",
          "title: Imported metadata",
          "tags: [design, review]",
          "updatedAt: 1710000000000",
          "priority: 3",
          "audience: [internal, partner]",
          "---",
          "# Imported body",
        ].join("\n"),
      },
    ]);
    await page.getByRole("dialog", { name: "Import Markdown File", exact: true })
      .getByRole("button", { name: "Add as New Note", exact: true }).click();
    const resultDialog = page.getByRole("dialog", { name: "Import Complete" });
    await expectResultValue(resultDialog, "Added", "1");
    await resultDialog.getByRole("button", { name: "Close" }).click();
    await page.locator(".note-item", { hasText: "Imported metadata" }).click();

    await clickNoteAction(page, "Metadata");
    const metadataDialog = page.getByRole("dialog", { name: "Metadata" });
    expect(await inputValues(metadataDialog.locator(".metadata-custom-key"))).toEqual([
      "priority",
      "audience",
    ]);
    await metadataDialog.getByRole("button", { name: "Cancel" }).click();
    await clickNoteAction(page, "Export Markdown");
    const exportDialog = page.getByRole("dialog", { name: "Export Markdown", exact: true });
    await expect(exportDialog.getByRole("button", { name: "Google Drive", exact: true })).toBeDisabled();
    await exportDialog.getByRole("button", { name: "Local", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__downloadText ?? "")).toContain(
      "# Imported body"
    );

    const markdown = await page.evaluate(() => window.__downloadText ?? "");
    const orderedKeys = [
      "id:",
      "title:",
      "tags:",
      "updatedAt:",
      "priority:",
      "audience:",
    ];
    const positions = orderedKeys.map((key) => markdown.indexOf(`\n${key}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    await expect.poll(() => page.evaluate(() => window.__downloadFileName)).toBe(
      "Imported metadata.md"
    );
  });
});
