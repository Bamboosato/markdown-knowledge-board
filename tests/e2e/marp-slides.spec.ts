import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function createSavedNote(page: Page, title: string, body: string) {
  await page.getByRole("button", { name: /new note/i }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Body").fill(body);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Status: Saved")).toBeVisible();
}

test.describe("A2 Marp slides", () => {
  test("renders metadata-driven Marp slides and exports frontmatter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Marp deck",
      [
        "# First Slide",
        "",
        "Intro content",
        "",
        "---",
        "",
        "# Second Slide",
        "",
        "```ts",
        "const value = 1;",
        "```",
      ].join("\n")
    );

    await page.getByLabel("Marp").check();
    await page.getByLabel("Size").selectOption("4:3");
    await page.getByLabel("Theme").selectOption("gaia");
    await page.getByLabel("Page numbers").uncheck();

    const bodyValue = await page.getByLabel("Body").inputValue();
    expect(bodyValue).not.toContain("marp: true");
    expect(bodyValue).not.toContain("theme: gaia");

    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Slides" }).click();

    await expect(page.getByText("1 / 2")).toBeVisible({ timeout: 15_000 });
    const slideViewportBox = await page.locator(".slides-viewport").boundingBox();
    expect(slideViewportBox).not.toBeNull();
    expect(slideViewportBox!.width / slideViewportBox!.height).toBeCloseTo(
      4 / 3,
      1
    );
    const canReachSlideBottom = await page
      .locator(".slides-shell")
      .evaluate((shell) => {
        const viewport = shell.querySelector(".slides-viewport");
        if (!(viewport instanceof HTMLElement)) {
          return false;
        }

        shell.scrollTop = shell.scrollHeight;
        const shellRect = shell.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        return viewportRect.bottom <= shellRect.bottom + 1;
      });
    expect(canReachSlideBottom).toBe(true);
    const slideThemeStyles = await page
      .frameLocator('iframe[title="Slide preview"]')
      .locator("section")
      .first()
      .evaluate((section) => {
        const styles = getComputedStyle(section);
        return {
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          theme: section.getAttribute("data-theme"),
        };
      });
    expect(slideThemeStyles).toEqual({
      backgroundColor: "rgb(255, 248, 225)",
      color: "rgb(69, 90, 100)",
      theme: "gaia",
    });
    await expect(
      page.frameLocator('iframe[title="Slide preview"]').getByRole("heading", {
        name: "First Slide",
      })
    ).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("2 / 2")).toBeVisible();
    await expect(
      page.frameLocator('iframe[title="Slide preview"]').getByRole("heading", {
        name: "Second Slide",
      })
    ).toBeVisible();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.locator(".slides-shell").press("Home");
    await expect(page.getByText("1 / 2")).toBeVisible();

    await page.locator(".slides-shell").press("End");
    await expect(page.getByText("2 / 2")).toBeVisible();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const exported = await readFile(path!, "utf8");
    expect(exported).toContain("marp: true");
    expect(exported).toContain("theme: gaia");
    expect(exported).toMatch(/size:\s+['"]?4:3['"]?/);
    expect(exported).toContain("paginate: false");
    expect(exported).not.toContain("<!--");
  });

  test("shows guidance when a note is not a Marp deck", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Regular note",
      ["# Regular Note", "", "This note has no Marp directive."].join("\n")
    );

    await page.getByRole("button", { name: "Slides" }).click();

    await expect(
      page.getByText("Slides unavailable for this note.")
    ).toBeVisible();
    await expect(page.getByText("Turn on Marp in Edit to use Slides.")).toBeVisible();
    await expect(page.getByText("Status: Saved")).toBeVisible();
  });

  test("uses UI settings over legacy Marp frontmatter in the body", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Legacy Marp body",
      [
        "---",
        "marp: true",
        "theme: uncover",
        "size: 16:9",
        "paginate: true",
        "---",
        "# First Slide",
        "",
        "---",
        "",
        "# Second Slide",
      ].join("\n")
    );

    await page.getByLabel("Marp").check();
    await page.getByLabel("Size").selectOption("4:3");
    await page.getByLabel("Theme").selectOption("gaia");
    await page.getByLabel("Page numbers").uncheck();

    await page.getByRole("button", { name: "Slides" }).click();
    await expect(page.getByText("1 / 2")).toBeVisible({ timeout: 15_000 });

    const firstSlideState = await page
      .frameLocator('iframe[title="Slide preview"]')
      .locator("section")
      .first()
      .evaluate((section) => {
        const styles = getComputedStyle(section);
        const afterStyles = getComputedStyle(section, "::after");
        return {
          afterContent: afterStyles.content,
          afterDisplay: afterStyles.display,
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          paginate: section.getAttribute("data-paginate"),
          pagination: section.getAttribute("data-marpit-pagination"),
          theme: section.getAttribute("data-theme"),
        };
      });

    expect(firstSlideState).toEqual({
      afterContent: '""',
      afterDisplay: "none",
      backgroundColor: "rgb(255, 248, 225)",
      color: "rgb(69, 90, 100)",
      paginate: null,
      pagination: null,
      theme: "gaia",
    });
  });
});
