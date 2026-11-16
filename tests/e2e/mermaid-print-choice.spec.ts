import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Exercise the real print entry points; inspect the print surface before afterprint.
// Cover both layouts, cancellation/focus, per-request defaults, and parser boundaries.
async function prepare(page: Page, body: string, styled: boolean) {
  await page.addInitScript(() => {
    window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByLabel("Title").fill("Mermaid print choice");
  await page.getByLabel("Body").fill(body);
  await page.getByRole("button", { name: /^Save$/ }).click();
  if (styled) {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Export Styled HTML/ }).click();
    await expect(page.getByRole("button", { name: "Print / PDF", exact: true })).toBeEnabled();
  }
}

async function openPrint(page: Page, styled: boolean) {
  if (!styled) {
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Print Mermaid as source" })).toHaveCount(0);
  }
  await page.getByRole(styled ? "button" : "menuitem", { name: "Print / PDF", exact: true }).click();
}

for (const styled of [false, true]) {
  const view = styled ? "Styled" : "Preview";
  for (const width of [390, 1280]) {
    test(`${view} print choice: cancel, source, reset and diagrams at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      const alerts: string[] = [];
      page.on("dialog", async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
      await prepare(page, "```mermaid\ngraph TD\nA[Start] --> B[End]\n```\n\n> ~~~Mermaid\n> graph LR\n> C --> D\n> ~~~", styled);
      const surface = page.locator(styled ? ".styled-export-preview-wrap" : ".print-surface");
      await expect(surface.locator("svg")).toHaveCount(2);
      await expect(page.getByRole("checkbox", { name: "Print Mermaid as source" })).toHaveCount(0);
      await openPrint(page, styled);
      const dialog = page.getByRole("dialog", { name: "Mermaid output" });
      const diagramChoice = dialog.getByRole("radio", { name: /Diagrams \(recommended\)/ });
      await expect(dialog).toBeVisible();
      await expect(diagramChoice).toBeChecked();
      await expect(diagramChoice).toBeFocused();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
      await page.screenshot({ path: testInfo.outputPath("print-choice.png") });
      await dialog.getByRole("button", { name: "Continue to print" }).focus();
      await page.keyboard.press("Tab");
      await expect(diagramChoice).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);
      await expect(page.getByRole("button", { name: styled ? "Print / PDF" : "More actions", exact: true })).toBeFocused();
      await openPrint(page, styled);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);

      await openPrint(page, styled);
      await dialog.getByRole("radio", { name: /Source code/ }).check();
      await dialog.getByRole("button", { name: "Continue to print" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
      await expect(dialog).toHaveCount(0);
      await expect(surface.locator('[data-print-fallback="source"]')).toHaveCount(2);
      await page.emulateMedia({ media: "print" });
      await expect(surface.locator(".mermaid-print-fallback pre").first()).toBeVisible();
      await expect(surface.locator("svg").first()).toBeHidden();
      await page.emulateMedia({ media: "screen" });
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      await expect(surface.locator("[data-print-fallback]")).toHaveCount(0);

      await openPrint(page, styled);
      await expect(diagramChoice).toBeChecked();
      await dialog.getByRole("button", { name: "Continue to print" }).click();
      await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(2);
      await page.emulateMedia({ media: "print" });
      await expect(surface.locator("svg").first()).toBeVisible();
      await expect(surface.locator("[data-print-fallback]")).toHaveCount(0);
      expect(alerts).toEqual([]);
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    });
  }

  test(`${view} skips choice for Mermaid words and fenced examples`, async ({ page }) => {
    await prepare(page, 'Mermaid is mentioned here. Inline: `mermaid`.\n\n````markdown\n```mermaid\ngraph TD\nA --> B\n```\n````', styled);
    await openPrint(page, styled);
    await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
    await expect(page.getByRole("dialog", { name: "Mermaid output" })).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  });
}

test("Preview source printing does not wait for an unfinished diagram", async ({ page }) => {
  await page.route("**/src/lib/mermaidRenderer.ts*", route => route.fulfill({
    contentType: "text/javascript",
    body: "export const MERMAID_CODE_SIZE_LIMIT_BYTES = 51200; export function renderMermaidSvg() { return new Promise(() => {}); }",
  }));
  await prepare(page, "```mermaid\ngraph TD\nA --> B\n```", false);
  await openPrint(page, false);
  await page.getByRole("radio", { name: /Source code/ }).check();
  await page.getByRole("button", { name: "Continue to print" }).click();
  await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator('.print-surface [data-print-fallback="source"]')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
});

test("Preview clears the source choice when print preparation fails", async ({ page }) => {
  await page.route("https://fixture.invalid/broken.png", route => route.fulfill({ status: 404, body: "missing" }));
  const alerts: string[] = [];
  page.on("dialog", async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
  await prepare(page, "```mermaid\ngraph TD\nA --> B\n```\n\n![broken](https://fixture.invalid/broken.png)", false);
  await openPrint(page, false);
  await page.getByRole("radio", { name: /Source code/ }).check();
  await page.getByRole("button", { name: "Continue to print" }).click();
  await expect.poll(() => alerts.length).toBe(1);
  expect(alerts[0]).toContain("An image could not be decoded");
  await expect(page.locator('.print-surface [data-print-fallback]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__printCalls ?? 0)).toBe(0);
  await openPrint(page, false);
  await expect(page.getByRole("radio", { name: /Diagrams \(recommended\)/ })).toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
