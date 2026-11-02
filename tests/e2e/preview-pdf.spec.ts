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
    __releaseFonts?: () => void;
    __allowMermaid?: boolean;
    __pendingMermaid?: Promise<string>;
    __resolveMermaid?: (svg: string) => void;
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
  test("rejects a failed image and leaves printing available for retry", async ({ page }) => {
    await stubBrowserPrint(page);
    await page.goto("/");
    await createSavedNote(page, "Broken image", "![missing](/missing-print-image.png)");
    let message = "";
    page.once("dialog", async (dialog) => { message = dialog.message(); await dialog.accept(); });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    expect(message).toContain("image");
    expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Print / PDF" })).toBeEnabled();
  });

  test("discards an old print attempt when the selected note changes", async ({ page }) => {
    await stubBrowserPrint(page);
    await page.goto("/");
    await createSavedNote(page, "First print note", "First content");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await createSavedNote(page, "Second print note", "Second content");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open note: First print note" }).click();
    await page.evaluate(() => {
      const pending = new Promise<FontFaceSet>((resolve) => { window.__releaseFonts = () => resolve(document.fonts); });
      Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => pending });
    });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open note: Second print note" }).click();
    await page.evaluate(() => window.__releaseFonts?.());
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Print / PDF" })).toBeEnabled();
    expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);
  });

  test("does not print when fonts time out and allows another attempt", async ({ page }) => {
    await stubBrowserPrint(page);
    await page.goto("/");
    await createSavedNote(page, "Font timeout", "Content");
    await page.clock.install();
    await page.evaluate(() => Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => new Promise(() => {}) }));
    let message = "";
    page.once("dialog", async (dialog) => { message = dialog.message(); await dialog.accept(); });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await page.clock.fastForward(10_000);
    await expect.poll(() => message).toContain("timed out");
    expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Print / PDF" })).toBeEnabled();
  });

  test("recovers when the browser does not emit afterprint", async ({ page }) => {
    await page.goto("/");
    await createSavedNote(page, "No afterprint", "Content");
    await page.clock.install();
    await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    await page.clock.fastForward(60_000);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Print / PDF" })).toBeEnabled();
  });

  test("prints an oversized Mermaid block as code and permits retry after print throws", async ({ page }) => {
    await stubBrowserPrint(page);
    await page.goto("/");
    const code = `graph TD\nA-->B\n%%${"x".repeat(51200)}`;
    await createSavedNote(page, "Large Mermaid", `\`\`\`mermaid\n${code}\`\`\``);
    const block = page.locator('.print-surface [data-mermaid-status="too-large"]');
    await expect(block.locator("pre code")).toContainText("A-->B");
    await page.evaluate(() => { window.print = () => { throw new Error("simulated print failure"); }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Print / PDF" })).toBeEnabled();
    await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; window.dispatchEvent(new Event("afterprint")); }; });
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
  });

  test("offline Styled HTML keeps content and makes no external requests", async ({ page, context }, testInfo) => {
    await page.goto("/");
    await createSavedNote(page, "Offline styled", "# Offline heading\n\nLocal content remains in the exported file.");
    await context.setOffline(true);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    const exportButton = page.getByRole("button", { name: "Download HTML" });
    await expect(exportButton).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;
    const destination = testInfo.outputPath("offline-styled.html");
    await download.saveAs(destination);
    await context.setOffline(false);
    const rendered = await context.newPage();
    const externalRequests: string[] = [];
    rendered.on("request", (request) => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
    await rendered.goto(new URL(`file:///${destination.replace(/\\/g, "/")}`).href);
    await expect(rendered.locator("body")).toContainText("Local content remains in the exported file.");
    await rendered.waitForLoadState("networkidle");
    expect(externalRequests).toEqual([]);
    await rendered.close();
  });

  test("exports a tall rendered Mermaid as source without overlapping following content", async ({ page }, testInfo) => {
    await page.goto("/");
    const graph = ["graph TD", ...Array.from({ length: 60 }, (_, i) => `N${i}[NODE${i}]${i < 59 ? ` --> N${i + 1}` : ""}`)].join("\n");
    await createSavedNote(page, "Tall Mermaid", `\`\`\`mermaid\n${graph}\n\`\`\`\n\nDiagram end marker.`);
    await expect(page.locator('.print-surface [data-mermaid-status="rendered"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('.print-surface [data-print-fallback="oversized"]')).toHaveCount(1);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".print-surface .mermaid-print-fallback")).toBeVisible();
    await expect(page.locator(".print-surface .mermaid-diagram-panel")).toBeHidden();
    await expect(page.locator(".print-surface .mermaid-print-fallback pre")).toHaveCSS("max-height", "none");
    const simple = await page.pdf({ path: testInfo.outputPath("large-diagram-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(simple.byteLength).toBeGreaterThan(1000);
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('.styled-export-preview-wrap [data-print-fallback="oversized"]')).toHaveCount(1);
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".styled-export-preview-wrap .mermaid-print-fallback")).toBeVisible();
    await expect(page.locator('.styled-export-preview-wrap [role="img"]')).toBeHidden();
    const styled = await page.pdf({ path: testInfo.outputPath("large-diagram-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(styled.byteLength).toBeGreaterThan(1000);
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => { document.body.classList.remove("styled-export-printing"); window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; window.dispatchEvent(new Event("afterprint")); }; });
    let warning = "";
    page.once("dialog", async (dialog) => { warning = dialog.message(); await dialog.accept(); });
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    expect(warning).toContain("Mermaid");
  });

  test("generates a tall-image PDF for visual review", async ({ page }, testInfo) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="3000" viewBox="0 0 100 3000"><rect width="100" height="3000" fill="#cde"/><text x="2" y="30">TOP</text><text x="2" y="2980">BOTTOM</text></svg>';
    const image = "https://fixture.invalid/tall.svg";
    await page.route(image, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svg }));
    await page.goto("/");
    await createSavedNote(page, "Tall image", `![tall](${image})\n\nImage end marker.`);
    await expect(page.locator(".print-surface img")).toHaveCount(1);
    await expect.poll(() => page.locator(".print-surface img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await page.pdf({ path: testInfo.outputPath("large-image-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await page.getByRole("button", { name: "Load HTTPS images" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled({ timeout: 20_000 });
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    await page.pdf({ path: testInfo.outputPath("large-image-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  });

  for (const [height, fallback] of [[1200, false], [1800, true]] as const) {
    test(`checks print geometry for a 1200 by ${height} Mermaid SVG`, async ({ page }, testInfo) => {
      await page.route("**/src/lib/mermaidRenderer.ts", (route) => route.fulfill({
        contentType: "text/javascript",
        body: `export const MERMAID_CODE_SIZE_LIMIT_BYTES = 51200;
          export async function renderMermaidSvg() { return '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 1200 ${height}" style="max-width: 1200px"><rect width="1200" height="${height}" fill="#eef"/><text x="20" y="80">SVG TOP</text><text x="20" y="${height - 50}">SVG BOTTOM</text></svg>'; }`,
      }));
      await page.goto("/");
      await createSavedNote(page, `Boundary ${height}`, "```mermaid\ngraph TD\n A --> B\n```\n\nBoundary end marker.");
      const simple = page.locator('.print-surface [data-mermaid-status="rendered"]');
      await expect(simple).toHaveCount(1, { timeout: 20_000 });
      if (fallback) await expect(simple).toHaveAttribute("data-print-fallback", "oversized");
      else await expect(simple).not.toHaveAttribute("data-print-fallback", "oversized");
      await page.pdf({ path: testInfo.outputPath(`boundary-${height}-simple.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
      await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
      const styled = page.locator(".styled-export-mermaid");
      if (fallback) await expect(styled).toHaveAttribute("data-print-fallback", "oversized");
      else await expect(styled).not.toHaveAttribute("data-print-fallback", "oversized");
      await page.evaluate(() => document.body.classList.add("styled-export-printing"));
      await page.pdf({ path: testInfo.outputPath(`boundary-${height}-styled.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
    });
  }

  test("Styled initialization times out and retries an unresolved Mermaid render", async ({ page }) => {
    await page.route("**/src/lib/mermaidRenderer.ts", (route) => route.fulfill({
      contentType: "text/javascript",
      body: `export const MERMAID_CODE_SIZE_LIMIT_BYTES = 51200;
        export function renderMermaidSvg(code, id) {
          if (id.startsWith('styled-export') && !window.__allowMermaid) return new Promise(() => {});
          return Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10">ok</text></svg>');
        }`,
    }));
    await page.goto("/");
    await createSavedNote(page, "Styled timeout", "```mermaid\ngraph TD\n A --> B\n```");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("alert")).toContainText("timed out", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeDisabled();
    await page.evaluate(() => { window.__allowMermaid = true; });
    await page.getByRole("button", { name: "Retry preparation" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Export Styled HTML / PDF" })).toBeVisible();
  });

  test("Styled export retains its snapshot after another note is selected", async ({ page }) => {
    await page.goto("/");
    await createSavedNote(page, "Snapshot original", "Original snapshot content");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await createSavedNote(page, "Snapshot other", "Different note content");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open note: Snapshot original" }).click();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open note: Snapshot other" }).click();
    await expect(page.locator(".styled-export-preview-wrap")).toContainText("Original snapshot content");
    await expect(page.locator(".styled-export-preview-wrap")).not.toContainText("Different note content");
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
  });

  test("Styled initialization retains its snapshot during a note switch", async ({ page }) => {
    await page.addInitScript(() => { window.__pendingMermaid = new Promise((resolve) => { window.__resolveMermaid = resolve; }); });
    await page.route("**/src/lib/mermaidRenderer.ts", (route) => route.fulfill({
      contentType: "text/javascript",
      body: `export const MERMAID_CODE_SIZE_LIMIT_BYTES = 51200;
        export function renderMermaidSvg(code, id) { return id.startsWith('styled-export') ? window.__pendingMermaid : Promise.resolve('<svg viewBox="0 0 100 100"></svg>'); }`,
    }));
    await page.goto("/");
    await createSavedNote(page, "Pending original", "Original pending snapshot\n\n```mermaid\ngraph TD\nA-->B\n```");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await createSavedNote(page, "Pending other", "Other content");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open note: Pending original" }).click();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeDisabled();
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "Open note: Pending other" }).click();
    await page.evaluate(() => window.__resolveMermaid?.('<svg viewBox="0 0 100 100"></svg>'));
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await expect(page.locator(".styled-export-preview-wrap")).toContainText("Original pending snapshot");
    await expect(page.locator(".styled-export-preview-wrap")).not.toContainText("Other content");
  });

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

  test("generates a Japanese and long-content fixture for visual PDF review", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "page.pdf is Chromium-only");
    await page.goto("/");
    const fence = "`".repeat(3);
    const body = [
      "# 日本語の組版（確認）",
      ...Array.from({ length: 35 }, (_, i) => `${i + 1} 行目。「句読点、括弧」と英数字ABCを含む文章です。長いURL https://example.com/${"abcdef".repeat(18)} を確認します。`),
      "## ページ境界の見出し", "後続の本文が見出しと一緒に表示されます。",
      [fence, ...Array.from({ length: 100 }, (_, i) => `line ${i + 1}: ${"long-code ".repeat(20)}`), fence].join("\n"),
      ["| 列A | 列B |", "| --- | --- |", ...Array.from({ length: 100 }, (_, i) => `| 表の行 ${i + 1} | 内容 |`)].join("\n"),
      "\n終端の確認文字列 END-OF-FIXTURE",
    ].join("\n\n");
    await createSavedNote(page, "日本語PDFの確認", body);
    const pdf = await page.pdf({ path: testInfo.outputPath("japanese-print.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    const styledPdf = await page.pdf({ path: testInfo.outputPath("japanese-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(styledPdf.byteLength).toBeGreaterThan(1_000);
  });

  test("generates Japanese line and page-boundary fixtures for both print paths", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "page.pdf is Chromium-only");
    await page.goto("/");
    const phrase = "日本語の文章は、括弧（かっこ）と句読点。「開き括弧」と『閉じ括弧』を含みます。ABC123と日本語を混ぜて、自然な改行を確認します。";
    const body = Array.from({ length: 12 }, (_, i) => `## 境界見出し${i + 1}\n\n直後本文${i + 1}。${phrase.repeat(5)}\n\n${phrase.repeat(5)}`).join("\n\n");
    await createSavedNote(page, "禁則と見出し", body);
    await page.pdf({ path: testInfo.outputPath("kinsoku-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    await page.pdf({ path: testInfo.outputPath("kinsoku-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  });
});
