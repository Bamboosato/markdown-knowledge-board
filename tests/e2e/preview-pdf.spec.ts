import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readBodyEditorValue } from "./body-editor";

async function savePdfIfChromium(page: import("@playwright/test").Page, testInfo: import("@playwright/test").TestInfo, options: Parameters<import("@playwright/test").Page["pdf"]>[0]) {
  return testInfo.project.name === "chromium" ? page.pdf(options) : null;
}

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
    __savedPrintCanvases?: HTMLCanvasElement[];
    __printExceptionCalled?: boolean;
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
  test("hides the injected preview toolbar only during both print layouts", async ({ page }) => {
    await stubBrowserPrint(page);
    await page.goto("/");
    await createSavedNote(page, "Toolbar print", "# Print content\n\nEnd marker.");
    await page.evaluate(() => {
      const toolbar = document.createElement("vercel-live-feedback");
      toolbar.style.cssText = "position:fixed;right:20px;bottom:20px;width:40px;height:40px;background:red;";
      toolbar.attachShadow({ mode: "closed" }).innerHTML = "<span>Preview toolbar</span>";
      document.body.append(toolbar);
    });
    const toolbar = page.locator("body > vercel-live-feedback");
    await expect(toolbar).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    await page.emulateMedia({ media: "print" });
    await expect(toolbar).toBeHidden();
    await expect(page.locator(".print-surface")).toContainText("End marker.");
    await page.emulateMedia({ media: "screen" });
    await expect(toolbar).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    await page.emulateMedia({ media: "print" });
    await expect(toolbar).toBeHidden();
    await expect(page.locator(".styled-export-preview-wrap")).toContainText("End marker.");
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => document.body.classList.remove("styled-export-printing"));
    await expect(toolbar).toBeVisible();
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(2);
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
  });

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

  test("cancels preparation when the unsaved draft changes", async ({ page }) => {
    await stubBrowserPrint(page);
    await page.goto("/");
    await createSavedNote(page, "Changing draft", "Original content");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.evaluate(() => {
      const pending = new Promise<FontFaceSet>((resolve) => { window.__releaseFonts = () => resolve(document.fonts); });
      Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => pending });
    });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await page.getByRole("textbox", { name: "Body" }).fill("Changed while preparing");
    await page.evaluate(() => window.__releaseFonts?.());
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Print / PDF" })).toBeEnabled();
    expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);
    await expect(page.getByText("Status: Unsaved")).toBeVisible();
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
    await page.evaluate(() => { window.print = () => { window.__printExceptionCalled = true; throw new Error("simulated print failure"); }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printExceptionCalled ?? false)).toBe(true);
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
    const simple = await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-diagram-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    if (simple) expect(simple.byteLength).toBeGreaterThan(1000);
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('.styled-export-preview-wrap [data-print-fallback="oversized"]')).toHaveCount(1);
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".styled-export-preview-wrap .mermaid-print-fallback")).toBeVisible();
    await expect(page.locator('.styled-export-preview-wrap [role="img"]')).toBeHidden();
    const styled = await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-diagram-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    if (styled) expect(styled.byteLength).toBeGreaterThan(1000);
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => { document.body.classList.remove("styled-export-printing"); window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; window.dispatchEvent(new Event("afterprint")); }; });
    let warning = "";
    page.once("dialog", async (dialog) => { warning = dialog.message(); await dialog.accept(); });
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    expect(warning).toContain("Mermaid");
  });

  test("compares tall-image print pagination and proportional scaling", async ({ page }, testInfo) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="3000" viewBox="0 0 100 3000"><rect width="100" height="3000" fill="#cde"/><text x="2" y="30">TOP</text><text x="2" y="2980">BOTTOM</text></svg>';
    const image = "https://fixture.invalid/tall.svg";
    await page.route(image, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svg }));
    await page.goto("/");
    await createSavedNote(page, "Tall image", `![tall](${image})\n\nImage end marker.`);
    await expect(page.locator(".print-surface img")).toHaveCount(1);
    await expect.poll(() => page.locator(".print-surface img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-image-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    const trial = await page.addStyleTag({ content: "@media print { .print-mdPreview img, .styled-export-markdown img { break-inside: auto !important; } }" });
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-image-simple-auto.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await trial.evaluate((style) => { style.textContent = "@media print { .print-mdPreview img, .styled-export-markdown img { max-height: 245mm !important; width: auto !important; height: auto !important; } }"; });
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-image-simple-scaled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await trial.evaluate((style) => { style.textContent = "@media print { .print-mdPreview img, .styled-export-markdown img { break-inside: auto !important; } }"; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await page.getByRole("button", { name: "Load HTTPS images" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled({ timeout: 20_000 });
    await page.evaluate(() => document.body.classList.add("styled-export-printing"));
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-image-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await trial.evaluate((style) => { style.textContent = ""; });
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-image-styled-original.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await trial.evaluate((style) => { style.textContent = "@media print { .print-mdPreview img, .styled-export-markdown img { max-height: 245mm !important; width: auto !important; height: auto !important; } }"; });
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("large-image-styled-scaled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  });

  test("splits a tall image for both print paths without extra requests", async ({ page }, testInfo) => {
    const image = "https://fixture.invalid/slices.svg";
    const markers = [30, 690, 750, 1410, 1470, 2130, 2190, 2850, 2910, 2980];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="3000" viewBox="0 0 100 3000"><rect width="100" height="3000" fill="#cde"/>${markers.map((y) => `<text x="2" y="${y}">Y${y}</text>`).join("")}</svg>`;
    let requests = 0;
    await page.route(image, (route) => { requests++; return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }, body: svg }); });
    await page.goto("/");
    await createSavedNote(page, "Split image", `![tall](${image})\n\nImage end marker.`);
    await expect.poll(() => page.locator(".print-surface img").first().evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(3000);
    await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
    const beforeSimple = requests;
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    expect(requests).toBe(beforeSimple);
    await expect(page.locator(".print-surface .print-image-slice")).toHaveCount(5);
    await page.evaluate(() => { window.__savedPrintCanvases = Array.from(document.querySelectorAll('.print-surface .print-image-slice canvas')); });
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("split-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".print-surface .print-image-slice")).toHaveCount(0);
    expect(await page.evaluate(() => window.__savedPrintCanvases?.every((canvas) => canvas.width === 0 && canvas.height === 0))).toBe(true);
    await page.evaluate(() => { window.print = () => { window.__printExceptionCalled = true; throw new Error("simulated print failure"); }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printExceptionCalled ?? false)).toBe(true);
    await expect(page.locator(".print-surface .print-image-slice")).toHaveCount(0);
    await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await page.getByRole("button", { name: "Load HTTPS images" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    const originalStyledSource = await page.locator(".styled-export-preview-wrap img").getAttribute("src");
    const beforeStyled = requests;
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(2);
    expect(requests).toBe(beforeStyled);
    await expect(page.locator(".styled-export-preview-wrap .print-image-slice")).toHaveCount(5);
    await page.evaluate(() => { window.__savedPrintCanvases = Array.from(document.querySelectorAll('.styled-export-preview-wrap .print-image-slice canvas')); });
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".styled-export-preview-wrap img")).toBeHidden();
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("split-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".styled-export-preview-wrap .print-image-slice")).toHaveCount(0);
    await expect(page.locator(".styled-export-preview-wrap img")).toBeVisible();
    await expect(page.locator(".styled-export-preview-wrap img")).toHaveAttribute("src", originalStyledSource!);
    expect(await page.evaluate(() => window.__savedPrintCanvases?.every((canvas) => canvas.width === 0 && canvas.height === 0))).toBe(true);
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(3);
    await page.evaluate(() => { window.__savedPrintCanvases = Array.from(document.querySelectorAll('.styled-export-preview-wrap .print-image-slice canvas')); });
    await page.getByRole("button", { name: "Back to Preview" }).click();
    expect(await page.evaluate(() => window.__savedPrintCanvases?.every((canvas) => canvas.width === 0 && canvas.height === 0))).toBe(true);
    expect(await page.evaluate(() => document.body.classList.contains("styled-export-printing"))).toBe(false);
  });

  test("keeps split images inside table cells and quotes in both paths", async ({ page }, testInfo) => {
    const image = "https://fixture.invalid/wide-tall.svg";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="8000" viewBox="0 0 1000 8000"><rect width="1000" height="8000" fill="#cde"/><text x="10" y="30">TOP LEFT</text><text x="800" y="7980">BOTTOM RIGHT</text></svg>';
    await page.route(image, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svg }));
    await page.goto("/");
    await createSavedNote(page, "Narrow containers", `| First | Second |\n| --- | --- |\n| ![table](${image}) | other column |\n\n> ![quote](${image})\n\nFollowing marker.`);
    await expect.poll(() => page.locator(".print-surface img").count()).toBe(2);
    await expect.poll(() => page.locator(".print-surface img").first().evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(8000);
    await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    await page.emulateMedia({ media: "print" });
    for (const parent of [".print-surface td", ".print-surface blockquote"]) {
      const bounds = await page.locator(parent).first().evaluate((container) => {
        const child = container.querySelector(".print-image-slice")!.getBoundingClientRect();
        const outer = container.getBoundingClientRect();
        return { childLeft: child.left, childRight: child.right, left: outer.left, right: outer.right };
      });
      expect(bounds.childLeft).toBeGreaterThanOrEqual(bounds.left - 0.5);
      expect(bounds.childRight).toBeLessThanOrEqual(bounds.right + 0.5);
    }
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("narrow-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await page.getByRole("button", { name: "Load HTTPS images" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(2);
    await page.emulateMedia({ media: "print" });
    for (const parent of [".styled-export-preview-wrap td", ".styled-export-preview-wrap blockquote"]) {
      const bounds = await page.locator(parent).first().evaluate((container) => {
        const child = container.querySelector(".print-image-slice")!.getBoundingClientRect();
        const outer = container.getBoundingClientRect();
        return { childLeft: child.left, childRight: child.right, left: outer.left, right: outer.right };
      });
      expect(bounds.childLeft).toBeGreaterThanOrEqual(bounds.left - 0.5);
      expect(bounds.childRight).toBeLessThanOrEqual(bounds.right + 0.5);
    }
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("narrow-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  });

  test("keeps ordinary high-resolution and fitting table images as original images", async ({ page }, testInfo) => {
    const photo = "https://fixture.invalid/photo.jpg", cell = "https://fixture.invalid/fitting-cell.svg";
    const svg = (width: number, height: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#cde"/><text x="20" y="50">IMAGE TOP</text><text x="20" y="${height - 30}">IMAGE BOTTOM</text></svg>`;
    const photoData = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 2000; canvas.height = 3000;
      const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#cde"; ctx.fillRect(0, 0, 2000, 3000);
      ctx.fillStyle = "#000"; ctx.font = "40px sans-serif"; ctx.fillText("PHOTO TOP", 20, 60); ctx.fillText("PHOTO BOTTOM", 20, 2960);
      return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
    }), "base64");
    await page.route(photo, (route) => route.fulfill({ contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" }, body: photoData }));
    await page.route(cell, (route) => route.fulfill({ contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svg(1000, 2500) }));
    await page.goto("/");
    await createSavedNote(page, "Ordinary images", `![photo](${photo})\n\n| First | Second |\n| --- | --- |\n| ![cell](${cell}) | other column |\n\nFollowing marker.`);
    await expect.poll(() => page.locator(".print-surface img").count()).toBe(2);
    await expect.poll(() => page.locator(".print-surface img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000);
    await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
    await expect(page.locator(".print-surface .print-image-slice")).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".print-surface img")).toHaveCount(2);
    await expect(page.locator(".print-surface img").first()).toBeVisible();
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("ordinary-simple.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    if (process.env.PDF_COMPARE_PARENT === "1") {
      const oldCss = execFileSync("git", ["show", "f708207:src/App.css"], { encoding: "utf8" });
      const sheet = page.locator('style[data-vite-dev-id*="App.css"]');
      const currentCss = await sheet.textContent();
      await sheet.evaluate((element, css) => { element.textContent = css; }, oldCss);
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("ordinary-simple-parent-css.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
      await sheet.evaluate((element, css) => { element.textContent = css; }, currentCss);
    }
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await page.getByRole("button", { name: "Load HTTPS images" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(2);
    await expect(page.locator(".styled-export-preview-wrap .print-image-slice")).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".styled-export-preview-wrap img")).toHaveCount(2);
    await expect(page.locator(".styled-export-preview-wrap img").first()).toBeVisible();
    await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("ordinary-styled.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
    if (process.env.PDF_COMPARE_PARENT === "1") {
      const appCss = execFileSync("git", ["show", "f708207:src/App.css"], { encoding: "utf8" });
      const styledCss = execFileSync("git", ["show", "f708207:src/lib/styledExport/document.css"], { encoding: "utf8" });
      const appSheet = page.locator('style[data-vite-dev-id*="App.css"]');
      const styledSheet = page.locator(".styled-export-view > style");
      const currentAppCss = await appSheet.textContent(), currentStyledCss = await styledSheet.textContent();
      await appSheet.evaluate((element, css) => { element.textContent = css; }, appCss);
      await styledSheet.evaluate((element, css) => { element.textContent = css; }, styledCss);
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath("ordinary-styled-parent-css.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
      await appSheet.evaluate((element, css) => { element.textContent = css; }, currentAppCss);
      await styledSheet.evaluate((element, css) => { element.textContent = css; }, currentStyledCss);
    }
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  });

  for (const viewportWidth of [390, 1280]) {
    test(`matches Website print geometry at viewport ${viewportWidth}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewportWidth, height: 900 });
      const image = "https://fixture.invalid/website.svg";
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="3300" viewBox="0 0 1000 3300"><rect width="1000" height="3300" fill="#cde"/><text x="20" y="50">WEBSITE TOP</text><text x="20" y="3250">WEBSITE BOTTOM</text></svg>';
      await page.route(image, (route) => route.fulfill({ contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svg }));
      await page.goto("/");
      await createSavedNote(page, `Website ${viewportWidth}`, `![website](${image})\n\nWebsite end marker.`);
      await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
      await page.getByRole("button", { name: "Load HTTPS images" }).click();
      await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
      await page.getByLabel("Design").selectOption("website");
      await page.getByRole("button", { name: "Print / PDF" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
      await expect(page.locator(".styled-export-preview-wrap .print-image-slice")).toHaveCount(0);
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath(`website-${viewportWidth}.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    });
  }

  for (const format of ["png", "jpeg", "svg"] as const) {
    test(`preserves every pixel at slice boundaries for ${format} in both paths`, async ({ page }) => {
      const mime = format === "svg" ? "image/svg+xml" : `image/${format}`;
      const bars = [0, 719, 720, 721, 1439, 1440, 1441, 2159, 2160, 2161, 2600];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="2601"><rect width="100" height="2601" fill="#eeeeee"/>${bars.map((y, i) => `<rect x="0" y="${y}" width="100" height="1" fill="${i % 2 ? "#ff0000" : "#0000ff"}"/>`).join("")}</svg>`;
      const data = format === "svg" ? Buffer.from(svg) : Buffer.from((await page.evaluate(({ mime, bars }) => {
        const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 2601;
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#eeeeee"; ctx.fillRect(0, 0, 100, 2601);
        bars.forEach((y, i) => { ctx.fillStyle = i % 2 ? "#ff0000" : "#0000ff"; ctx.fillRect(0, y, 100, 1); });
        return canvas.toDataURL(mime, 1).split(",")[1];
      }, { mime, bars })), "base64");
      const url = `/fixture-slices-${format}`;
      await page.route(`**${url}`, (route) => route.fulfill({ status: 200, contentType: mime, body: data }));
      await page.goto("/");
      await createSavedNote(page, `Pixels ${format}`, `![fixture](${url})\n\nImage end marker.`);
      await expect.poll(() => page.locator(".print-surface img").first().evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(2601);
      await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
      const verifyPixels = async (scope: string) => {
        const result = await page.locator(scope).evaluate((root) => {
          const image = root.querySelector("img")!;
          const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>(".print-image-slice canvas"));
          const reference = document.createElement("canvas"); reference.width = image.naturalWidth; reference.height = image.naturalHeight;
          const ctx = reference.getContext("2d")!; ctx.drawImage(image, 0, 0);
          const expected = ctx.getImageData(0, 0, reference.width, reference.height).data;
          let offset = 0, mismatches = 0;
          for (const canvas of canvases) {
            const actual = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[offset + i]) mismatches++;
            offset += actual.length;
          }
          window.__savedPrintCanvases = canvases;
          return { count: canvases.length, actual: offset, expected: expected.length, mismatches };
        });
        expect(result).toEqual({ count: 5, actual: 100 * 2601 * 4, expected: 100 * 2601 * 4, mismatches: 0 });
      };
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Print / PDF" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
      await verifyPixels(".print-surface");
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      expect(await page.evaluate(() => window.__savedPrintCanvases?.every((canvas) => canvas.width === 0 && canvas.height === 0))).toBe(true);
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
      await page.locator('.styled-export-issues input[type="file"]').setInputFiles({ name: `fixture.${format}`, mimeType: mime, buffer: data });
      await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
      await page.getByRole("button", { name: "Print / PDF" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(2);
      await verifyPixels(".styled-export-preview-wrap");
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      expect(await page.evaluate(() => window.__savedPrintCanvases?.every((canvas) => canvas.width === 0 && canvas.height === 0))).toBe(true);
    });
  }

  for (const [height, expected] of [[1971, 0], [1972, 0], [1973, 4]] as const) {
    test(`uses image slicing threshold correctly at ${height}px in both paths`, async ({ page }) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="${height}"><rect width="100" height="${height}" fill="#cde"/></svg>`;
      const data = Buffer.from(svg);
      const url = `/threshold-${height}.svg`;
      await page.route(`**${url}`, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: data }));
      await page.goto("/");
      await createSavedNote(page, `Threshold ${height}`, `![threshold](${url})\n\nAfter image.`);
      await expect.poll(() => page.locator(".print-surface img").first().evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(height);
      await page.evaluate(() => { window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; }; });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Print / PDF" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(1);
      await expect(page.locator(".print-surface .print-image-slice")).toHaveCount(expected);
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
      await page.locator('.styled-export-issues input[type="file"]').setInputFiles({ name: `threshold-${height}.svg`, mimeType: "image/svg+xml", buffer: data });
      await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
      await page.getByRole("button", { name: "Print / PDF" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls ?? 0)).toBe(2);
      await expect(page.locator(".styled-export-preview-wrap .print-image-slice")).toHaveCount(expected);
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    });
  }

  for (const [width, height, orientation] of [[400, 300, "landscape"], [300, 400, "portrait"]] as const) {
    test(`preserves ${orientation} images in Preview, print and Styled HTML`, async ({ page, context }, testInfo) => {
      const image = `https://fixture.invalid/${orientation}.svg`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#cde"/><text x="10" y="30">IMAGE TOP</text><text x="10" y="${height - 20}">IMAGE BOTTOM</text></svg>`;
      await page.route(image, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: svg }));
      await page.goto("/");
      await createSavedNote(page, `Image ${orientation}`, `![${orientation}](${image})\n\nImage end marker.`);
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const previewImage = page.locator('.mdPreview:not(.print-mdPreview) img').first();
      await expect.poll(() => previewImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(width);
      const previewSize = await previewImage.evaluate((img: HTMLImageElement) => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }));
      expect(previewSize.w / previewSize.h).toBeCloseTo(width / height, 2);
      await page.emulateMedia({ media: "print" });
      const printImage = page.locator(".print-surface img");
      const printSize = await printImage.evaluate((img: HTMLImageElement) => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }));
      expect(printSize.w / printSize.h).toBeCloseTo(width / height, 2);
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath(`${orientation}-simple.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: "screen" });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
      await page.getByRole("button", { name: "Load HTTPS images" }).click();
      await expect(page.getByRole("button", { name: "Download HTML" })).toBeEnabled();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download HTML" }).click();
      const download = await downloadPromise;
      const destination = testInfo.outputPath(`${orientation}.html`);
      await download.saveAs(destination);
      const exported = await context.newPage();
      const external: string[] = [];
      exported.on("request", (request) => { if (/^https?:/i.test(request.url())) external.push(request.url()); });
      await exported.goto(new URL(`file:///${destination.replace(/\\/g, "/")}`).href);
      await expect.poll(() => exported.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(width);
      expect(external).toEqual([]);
      await exported.close();
      await page.evaluate(() => document.body.classList.add("styled-export-printing"));
      await page.emulateMedia({ media: "print" });
      const styledImage = page.locator(".styled-export-preview-wrap img");
      const styledSize = await styledImage.evaluate((img: HTMLImageElement) => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }));
      expect(styledSize.w / styledSize.h).toBeCloseTo(width / height, 2);
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath(`${orientation}-styled.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
    });
  }

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
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath(`boundary-${height}-simple.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
      await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
      const styled = page.locator(".styled-export-mermaid");
      if (fallback) await expect(styled).toHaveAttribute("data-print-fallback", "oversized");
      else await expect(styled).not.toHaveAttribute("data-print-fallback", "oversized");
      await page.evaluate(() => document.body.classList.add("styled-export-printing"));
      await savePdfIfChromium(page, testInfo, { path: testInfo.outputPath(`boundary-${height}-styled.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
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
    const inline = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>').toString("base64")}`;
    await createSavedNote(page, "Styled timeout", `![local](./fixture.svg)\n\n![inline](${inline})\n\n\`\`\`mermaid\ngraph TD\n A --> B\n\`\`\``);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("alert")).toContainText("timed out", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeDisabled();
    await page.getByLabel("Choose a local image for line 1").setInputFiles({ name: "fixture.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>') });
    const image = page.locator('.styled-export-preview-wrap img[alt="local"]');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("src", /^data:image\/svg\+xml/);
    const selectedSource = await image.getAttribute("src");
    await page.evaluate(() => { window.__allowMermaid = true; });
    await page.getByRole("button", { name: "Retry preparation" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
    await expect(image).toHaveAttribute("src", selectedSource!);
    await expect(page.locator('.styled-export-preview-wrap img[alt="inline"]')).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect(page.locator('.styled-export-issues input[type="file"]')).toHaveCount(0);
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
