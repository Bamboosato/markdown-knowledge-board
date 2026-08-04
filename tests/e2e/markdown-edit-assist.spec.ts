import { expect, test } from "@playwright/test";
import {
  expectBodyEditorValue,
  getBodyEditor,
} from "./body-editor";

async function dispatchWheel(
  locator: ReturnType<typeof getBodyEditor>,
  options: { ctrlKey?: boolean; deltaY: number },
) {
  return locator.evaluate((element, wheelOptions) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: wheelOptions.ctrlKey ?? false,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: wheelOptions.deltaY,
    });
    const dispatchResult = element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  }, options);
}

async function getFontSize(locator: ReturnType<typeof getBodyEditor>) {
  return locator.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
}

test.describe("Markdown edit assist", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: /new note/i }).click();
  });

  test("normal UI: colors only recognized Markdown markers in blue", async ({
    page,
  }) => {
    const body = getBodyEditor(page);
    const source = [
      "# Heading",
      "**strong** and ==highlight== and `code`",
      "| A | B |",
      "| :- | -: |",
      "| x | y |",
      "plain | pipe and ==unclosed",
    ].join("\n");

    await body.fill(source);
    await expectBodyEditorValue(body, source);

    const markers = page.locator(".cm-md-marker");
    await expect(markers.first()).toBeVisible();
    const rendered = await markers.evaluateAll((elements) =>
      elements.map((element) => ({
        color: getComputedStyle(element).color,
        fontSize: getComputedStyle(element).fontSize,
        text: element.textContent,
      })),
    );

    expect(rendered.map(({ text }) => text)).toEqual(
      expect.arrayContaining(["#", "**", "==", "`", "|", ":-", "-:"]),
    );
    expect(rendered.every(({ color }) => color === "rgb(37, 99, 235)")).toBe(
      true,
    );
    expect(new Set(rendered.map(({ fontSize }) => fontSize))).toEqual(
      new Set(["15.2px"]),
    );

    const markerText = rendered.map(({ text }) => text).join("");
    for (const content of ["Heading", "strong", "highlight", "code", "plain"])
      expect(markerText).not.toContain(content);
  });

  test("state transition: keeps document data isolated across Undo and note reset", async ({
    page,
  }) => {
    const body = getBodyEditor(page);
    await body.fill("First **note**");
    await body.press("Control+z");
    await expectBodyEditorValue(body, "");
    await body.press("Control+y");
    await expectBodyEditorValue(body, "First **note**");

    await page.getByLabel("Title").fill("First");
    await page.getByRole("button", { name: /^Save$/ }).click();
    const newNote = page.getByRole("button", { name: /new note/i });
    if (!(await newNote.isVisible())) {
      await page.getByRole("button", { name: "Notes" }).click();
    }
    await newNote.click();
    await expectBodyEditorValue(getBodyEditor(page), "");

    await getBodyEditor(page).press("Control+z");
    await expectBodyEditorValue(getBodyEditor(page), "");
  });

  test("normal interaction: applies toolbar edits to the CodeMirror selection", async ({
    page,
  }) => {
    const body = getBodyEditor(page);
    await body.fill("選択 text");
    await body.evaluate((element) => {
      const editor = element as HTMLElement & {
        setSelectionRange?: (start: number, end: number) => void;
      };
      editor.setSelectionRange?.(0, 2);
    });

    await page.getByRole("button", { name: "Format" }).click();
    await page.getByRole("menuitem", { name: "Bold" }).click();

    await expectBodyEditorValue(body, "**選択** text");
    await expect(body).toBeFocused();
    await expect
      .poll(() =>
        body.evaluate((element) => ({
          end: (element as HTMLElement & { selectionEnd?: number }).selectionEnd,
          start: (element as HTMLElement & { selectionStart?: number })
            .selectionStart,
        })),
      )
      .toEqual({ start: 2, end: 4 });
  });

  test("data and timing: commits a Chromium IME composition once", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "CDP IME composition is Chromium-only");

    const body = getBodyEditor(page);
    await body.focus();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      selectionEnd: 3,
      selectionStart: 3,
      text: "にほん",
    });
    await cdp.send("Input.imeSetComposition", {
      selectionEnd: 2,
      selectionStart: 2,
      text: "日本",
    });
    await cdp.send("Input.insertText", { text: "日本" });

    await expectBodyEditorValue(body, "日本");
  });

  test("normal and state transition: shares the PC font scale across Edit, Preview, and reload", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    expect(
      await page.evaluate(() =>
        matchMedia("(min-width: 901px) and (pointer: fine)").matches,
      ),
    ).toBe(true);

    const body = getBodyEditor(page);
    await page.getByLabel("Title").fill("Font scale note");
    await body.fill("# Readable heading\n\nBody text");
    await body.evaluate((element) => {
      const editor = element as HTMLElement & {
        setSelectionRange?: (start: number, end: number) => void;
      };
      editor.setSelectionRange?.(2, 10);
    });
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByLabel("Editor status")).toContainText("Status: Saved");
    await expect.poll(() => getFontSize(body)).toBeCloseTo(15.2, 2);

    const wheelResult = await dispatchWheel(body, {
      ctrlKey: true,
      deltaY: -100,
    });
    expect(wheelResult).toEqual({
      defaultPrevented: true,
      dispatchResult: false,
    });
    await expect(page.locator(".content-font-scale-indicator")).toHaveText(
      "Text size: 110%",
    );
    await expect.poll(() => getFontSize(body)).toBeCloseTo(16.72, 2);
    await expectBodyEditorValue(body, "# Readable heading\n\nBody text");
    await expect
      .poll(() =>
        body.evaluate((element) => ({
          end: (element as HTMLElement & { selectionEnd?: number }).selectionEnd,
          start: (element as HTMLElement & { selectionStart?: number })
            .selectionStart,
        })),
      )
      .toEqual({ start: 2, end: 10 });

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.locator(".mdPreview");
    await expect(preview).toBeVisible();
    await expect
      .poll(() => getFontSize(preview))
      .toBeCloseTo(17.6, 2);
    await expect
      .poll(() => getFontSize(preview.locator("h1")))
      .toBeCloseTo(23.76, 2);

    await page.reload();
    await page
      .getByRole("button", { name: "Open note: Font scale note" })
      .click();
    await expect(page.locator(".mdPreview")).toBeVisible();
    await expect
      .poll(() => getFontSize(page.locator(".mdPreview")))
      .toBeCloseTo(17.6, 2);

    const resetByWheel = await dispatchWheel(page.locator(".mdPreview"), {
      ctrlKey: true,
      deltaY: 100,
    });
    expect(resetByWheel.defaultPrevented).toBe(true);
    await expect(page.locator(".content-font-scale-indicator")).toHaveText(
      "Text size: 100%",
    );
    await expect
      .poll(() => getFontSize(page.locator(".mdPreview")))
      .toBeCloseTo(16, 2);
    await expect(
      page.getByRole("button", { name: /reset.*text|text.*reset/i }),
    ).toHaveCount(0);
  });

  test("boundary and environment: ignores normal wheel, content outside the target, and mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const body = getBodyEditor(page);
    await body.fill("Body text");

    const normalWheel = await dispatchWheel(body, { deltaY: -100 });
    expect(normalWheel.defaultPrevented).toBe(false);
    await expect.poll(() => getFontSize(body)).toBeCloseTo(15.2, 2);

    const outsideResult = await page.locator(".editor-header").evaluate((element) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(outsideResult).toBe(false);
    await expect.poll(() => getFontSize(body)).toBeCloseTo(15.2, 2);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileResult = await dispatchWheel(body, {
      ctrlKey: true,
      deltaY: -100,
    });
    expect(mobileResult.defaultPrevented).toBe(false);
    await expect.poll(() => getFontSize(body)).toBeCloseTo(15.2, 2);
    await expect(page.locator(".content-font-scale-indicator")).toHaveCount(0);
  });
});
