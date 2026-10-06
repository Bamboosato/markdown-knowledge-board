import { expect, test } from "@playwright/test";
import { readBodyEditorValue } from "./body-editor";

/**
 * Test viewpoints before cases:
 * - Functional: Print / PDF opens browser printing for the complete Preview document.
 * - Non-functional: print CSS removes viewport scroll clipping and keeps large content paginable.
 * - Data: title, tags, rendered Markdown, Mermaid, and unsaved draft content are retained.
 * - UI: application chrome and interactive Preview controls are excluded from print output.
 * - Normal/abnormal/boundary/state: saved note, Mermaid rendering, long content, and Edit-to-print
 *   draft transition are covered separately from the browser's native print dialog.
 */

declare global {
  interface Window {
    __printCalls?: number;
    __printTitle?: string;
  }
}

async function createSavedNote(
  page: import("@playwright/test").Page,
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

async function stubBrowserPrint(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.print = () => {
      window.__printCalls = (window.__printCalls ?? 0) + 1;
      window.__printTitle = document.title;
      window.dispatchEvent(new Event("afterprint"));
    };
  });
}

test.describe("Preview Print / PDF", () => {
  test("prints the complete rendered Preview document without application chrome", { tag: '@ci-smoke' }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubBrowserPrint(page);
    await page.goto("/");

    const mermaidFence = String.fromCharCode(96).repeat(3) + "mermaid";
    const codeFence = String.fromCharCode(96).repeat(3);
    const body = [
      "# First heading",
      "",
      "Intro paragraph before the long document.",
      "",
      "- [ ] Open task",
      "- [x] Completed task",
      "",
      "| Column A | Column B |",
      "| --- | --- |",
      "| Value 1 | Value 2 |",
      "",
      mermaidFence,
      "graph TD",
      "  A[Start] --> B[Finish]",
      codeFence,
      "",
      ...Array.from(
        { length: 70 },
        (_, index) =>
          "Paragraph " +
          (index + 1) +
          ": this content verifies that the print surface contains the middle of a long Preview document."
      ),
      "",
      "# Last heading",
      "",
      "The final paragraph must remain available after print layout expansion.",
    ].join("\n");

    await createSavedNote(page, "PDF document title", body, ["reference", "print"]);
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(
      page.locator('.print-surface [data-mermaid-status="rendered"]')
    ).toHaveAttribute("data-mermaid-status", "rendered", { timeout: 15_000 });

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();

    await expect
      .poll(() => page.evaluate(() => window.__printCalls ?? 0))
      .toBe(1);
    expect(
      await page.evaluate(() => window.__printTitle)
    ).toBe("PDF document title - Markdown Knowledge Board");

    await page.emulateMedia({ media: "print" });
    const printSurface = page.locator(".print-surface");
    await expect(printSurface).toBeVisible();
    await expect(printSurface).toContainText("PDF document title");
    await expect(printSurface).toContainText("reference");
    await expect(printSurface).toContainText("Paragraph 35");
    await expect(printSurface).toContainText("Last heading");
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await expect(page.locator(".editor-header")).not.toBeVisible();
    await expect(printSurface.locator(".taskCheckbox")).toHaveCount(0);
    await expect(printSurface.locator(".print-task-checkbox")).toHaveCount(2);
    await expect(printSurface.locator(".mermaid-block-header")).toBeHidden();
    await expect(printSurface.locator(".print-mdPreview")).toHaveAttribute(
      "data-preview-mode",
      "print"
    );
  });

  test("prints current unsaved draft from Edit without changing dirty data", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubBrowserPrint(page);
    await page.goto("/");

    await createSavedNote(page, "Saved title", "Saved body");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Unsaved PDF title");
    await page.getByRole("textbox", { name: "Body" }).fill(
      "# Unsaved heading\n\nThis draft must be printed before Save."
    );

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__printCalls ?? 0))
      .toBe(1);

    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".print-surface")).toContainText(
      "Unsaved PDF title"
    );
    await expect(page.locator(".print-surface")).toContainText(
      "This draft must be printed before Save."
    );

    await page.emulateMedia({ media: "screen" });
    await expect(page.getByText("Status: Unsaved")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Unsaved PDF title"
    );
    const bodyValue = await readBodyEditorValue(
      page.getByRole("textbox", { name: "Body" })
    );
    expect(bodyValue).toContain("This draft must be printed before Save.");
  });

  test("generates a non-empty Chromium PDF from the print layout", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "page.pdf is Chromium-only");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await createSavedNote(
      page,
      "PDF artifact",
      "# PDF artifact heading\n\nThe PDF must contain the complete print surface."
    );

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });
});
