import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function createSavedNote(page: Page, title: string, body: string) {
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Body").fill(body);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Status: Saved")).toBeVisible();
}

test.describe("A1 Mermaid preview", () => {
  test("keeps ordinary fenced code blocks fully visible", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await page.goto("/");

    const codeLines = [
      "位置情報権限",
      "Health Connect歩数読み取り権限",
      "身体活動権限",
      "通知権限",
      "位置情報サービス",
    ];
    await createSavedNote(
      page,
      "Text code block",
      [
        "# A-02 権限確認画面",
        "",
        "確認対象:",
        "",
        "```text",
        ...codeLines,
        "```",
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview" }).click();

    const preview = page.locator(".preview-panel");
    const codeBlock = preview.locator("pre code.language-text");
    await expect(codeBlock).toContainText(codeLines.join("\n"));
    await expect(codeBlock).toHaveCSS("padding", "0px");
    await expect(codeBlock).toHaveCSS("border-radius", "0px");
    await expect(codeBlock).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const lineStarts = await codeBlock.evaluate((element) => {
      const textNode = element.firstChild;
      if (!(textNode instanceof Text)) {
        return [];
      }
      const offsets = [0, ...Array.from(textNode.data.matchAll(/\n/g), (match) => match.index + 1)]
        .filter((offset) => offset < textNode.length);
      return offsets.map((offset) => {
        const range = document.createRange();
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset + 1);
        return range.getBoundingClientRect().left;
      });
    });
    expect(new Set(lineStarts.map((left) => Math.round(left))).size).toBe(1);
    const codeBlockBox = await preview.locator(".mdPreview pre").boundingBox();
    expect(codeBlockBox).not.toBeNull();
    expect(codeBlockBox!.height).toBeGreaterThan(120);
  });

  test("uses the semantic Preview palette for content and interaction states", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 720 });
    await page.goto("/");
    await createSavedNote(
      page,
      "Preview palette",
      [
        "# Preview palette",
        "",
        "Body with [Example link](https://example.com) and `inline code`.",
        "",
        "> Quoted text",
        "",
        "- [x] Completed task",
        "",
        "```text",
        "code block",
        "```",
        "",
        "| Header | Value |",
        "| --- | --- |",
        "| A | B |",
      ].join("\n")
    );
    await page.getByRole("button", { name: "Preview", exact: true }).click();

    const panel = page.locator(".preview-panel");
    const tokens = await panel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.getPropertyValue("--preview-bg").trim(),
        text: style.getPropertyValue("--preview-text").trim(),
        link: style.getPropertyValue("--preview-link").trim(),
        focus: style.getPropertyValue("--preview-focus").trim(),
      };
    });
    expect(tokens).toEqual({
      background: "#fafafa",
      text: "#1f1f1f",
      link: "#1d4ed8",
      focus: "#2563eb",
    });
    await expect(panel).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await expect(panel).toHaveCSS("color", "rgb(31, 31, 31)");

    const link = page.getByRole("link", { name: "Example link" });
    await expect(link).toHaveCSS("color", "rgb(29, 78, 216)");
    await link.hover();
    await expect(link).toHaveCSS("color", "rgb(30, 64, 175)");
    await link.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(link).toHaveCSS("outline-color", "rgb(37, 99, 235)");

    await expect(panel.locator(".mdPreview code").filter({ hasText: "inline code" })).toHaveCSS(
      "background-color",
      "rgb(238, 241, 244)"
    );
    const codeBlock = panel.locator(".mdPreview pre");
    await expect(codeBlock).toHaveCSS("background-color", "rgb(238, 241, 244)");
    await expect(codeBlock).toHaveCSS("border-color", "rgb(199, 203, 209)");

    const tableHeader = page.getByRole("columnheader", { name: "Header" });
    await expect(tableHeader).toHaveCSS("background-color", "rgb(241, 243, 245)");
    await expect(tableHeader).toHaveCSS("font-weight", "700");

    const quote = panel.locator(".mdPreview blockquote");
    await expect(quote).toHaveCSS("color", "rgb(85, 85, 85)");
    const completedText = panel.locator(".mdPreview li.task-list-item .taskText", {
      hasText: "Completed task",
    });
    await expect(completedText).toHaveCSS("color", "rgb(102, 102, 102)");
    await expect(completedText).toHaveCSS("opacity", "1");
    await expect(completedText).toHaveCSS("text-decoration-line", "line-through");
  });

  test("renders a Mermaid diagram and keeps code view accessible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    const diagramLabels = ["位置情報権限", "通知権限"];

    await createSavedNote(
      page,
      "Mermaid flowchart",
      [
        "# Mermaid Preview",
        "",
        "```mermaid",
        "flowchart TD",
        `  A[${diagramLabels[0]}] --> B[${diagramLabels[1]}]`,
        "```",
        "",
        "```js",
        'console.log("kept as code");',
        "```",
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview" }).click();

    const preview = page.locator(".preview-panel");
    await expect(preview.getByText("Mermaid", { exact: true })).toBeVisible();
    await expect(
      preview.getByRole("img", { name: /Mermaid diagram/ })
    ).toBeVisible({ timeout: 15_000 });
    await expect(preview.locator(".mermaid-diagram-svg svg")).toBeVisible();
    await expect(preview.locator(".mermaid-diagram-svg")).toContainText(
      diagramLabels[0]
    );
    await expect(preview.locator(".mermaid-diagram-svg")).toContainText(
      diagramLabels[1]
    );
    await expect(preview.locator("pre code.language-js")).toContainText(
      'console.log("kept as code");'
    );

    await page.getByRole("button", { name: "Show Code" }).click();
    await expect(preview.locator(".mermaid-code")).toContainText("flowchart TD");
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Show Diagram" }).click();
    await expect(
      preview.getByRole("img", { name: /Mermaid diagram/ })
    ).toBeVisible();
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });

  test("keeps Preview readable when a Mermaid diagram fails", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Broken Mermaid",
      [
        "# Broken Mermaid",
        "",
        "```mermaid",
        "this is not a diagram",
        "```",
        "",
        "## Still visible",
      ].join("\n")
    );

    await page.getByRole("button", { name: "Preview" }).click();

    await expect(
      page.getByRole("heading", { name: "Still visible" })
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Unable to render Mermaid diagram.",
      })
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Show Code" }).click();
    await expect(page.locator(".mermaid-code")).toContainText(
      "this is not a diagram"
    );
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });
});
