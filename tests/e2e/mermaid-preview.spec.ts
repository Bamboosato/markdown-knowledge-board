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

    const codeBlock = page.locator("pre code.language-text");
    await expect(codeBlock).toContainText(codeLines.join("\n"));
    const codeBlockBox = await page.locator(".mdPreview pre").boundingBox();
    expect(codeBlockBox).not.toBeNull();
    expect(codeBlockBox!.height).toBeGreaterThan(120);
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

    await expect(page.getByText("Mermaid", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Mermaid diagram/ })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".mermaid-diagram-svg svg")).toBeVisible();
    await expect(page.locator(".mermaid-diagram-svg")).toContainText(
      diagramLabels[0]
    );
    await expect(page.locator(".mermaid-diagram-svg")).toContainText(
      diagramLabels[1]
    );
    await expect(page.locator("pre code.language-js")).toContainText(
      'console.log("kept as code");'
    );

    await page.getByRole("button", { name: "Show Code" }).click();
    await expect(page.locator(".mermaid-code")).toContainText("flowchart TD");
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Show Diagram" }).click();
    await expect(
      page.getByRole("img", { name: /Mermaid diagram/ })
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
