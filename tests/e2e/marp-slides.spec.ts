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

    await expect(page.getByLabel("Slides settings")).toHaveCount(0);
    const bodyValue = await page.getByLabel("Body").inputValue();
    expect(bodyValue).not.toContain("marp: true");
    expect(bodyValue).not.toContain("theme: gaia");

    await page.getByRole("button", { name: "Preview" }).click();
    const previewPanelBox = await page.locator(".preview-panel").boundingBox();
    expect(previewPanelBox).not.toBeNull();

    const slidesButton = page.getByRole("button", { name: "Slides" });
    await slidesButton.click();
    const slidesPanelBox = await page.locator(".slides-shell").boundingBox();
    expect(slidesPanelBox).not.toBeNull();
    expect(slidesPanelBox!.y).toBeCloseTo(previewPanelBox!.y, 0);
    const slidesSettings = page.getByLabel("Slides settings");
    await expect(slidesSettings).toBeVisible();
    const [buttonBox, settingsBox] = await Promise.all([
      slidesButton.boundingBox(),
      slidesSettings.boundingBox(),
    ]);
    expect(buttonBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    expect(
      settingsBox!.x - (buttonBox!.x + buttonBox!.width)
    ).toBeGreaterThanOrEqual(16);

    await page.getByLabel("Marp", { exact: true }).check();
    await page.getByRole("button", { name: "Marp settings" }).click();
    await expect(page.getByText("Slide Settings", { exact: true })).toBeVisible();
    const settingSelectBoxes = await page
      .locator(".marp-value-select")
      .evaluateAll((selects) =>
        selects.map((select) => {
          const box = select.getBoundingClientRect();
          return { right: box.right, width: box.width };
        })
      );
    expect(settingSelectBoxes).toHaveLength(2);
    expect(settingSelectBoxes[0].width).toBeCloseTo(
      settingSelectBoxes[1].width,
      0
    );
    expect(settingSelectBoxes[0].right).toBeCloseTo(
      settingSelectBoxes[1].right,
      0
    );
    await page.getByLabel("Size").selectOption("4:3");
    await page.getByLabel("Theme").selectOption("gaia");
    await page.getByLabel("Page numbers").uncheck();
    await expect(
      page.getByLabel("Heading Divider", { exact: true })
    ).not.toBeChecked();
    await expect(page.getByLabel("Heading divider level")).toBeDisabled();

    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await expect(page.locator(".slides-toolbar .preview-label")).toHaveCount(0);

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
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const exported = await readFile(path!, "utf8");
    expect(exported).toContain("marp: true");
    expect(exported).toContain("theme: gaia");
    expect(exported).toMatch(/size:\s+['"]?4:3['"]?/);
    expect(exported).toContain("paginate: false");
    expect(exported).not.toContain("headingDivider");
    expect(exported).not.toContain("<!--");
  });

  test("automatically divides slides at the selected heading level", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto("/");

    await createSavedNote(
      page,
      "Heading divider deck",
      [
        "# First Slide",
        "",
        "Intro content",
        "",
        "# Second Slide",
        "",
        "More content",
      ].join("\n")
    );

    await page.getByRole("button", { name: "Slides" }).click();
    const settingsButton = page.getByRole("button", { name: "Marp settings" });
    await expect(settingsButton).toBeDisabled();

    await page.getByLabel("Marp", { exact: true }).check();
    await expect(settingsButton).toBeEnabled();
    await expect(settingsButton).toHaveAttribute("data-tooltip", "Marp settings");
    await settingsButton.click();
    await expect(page.getByText("Slide Settings", { exact: true })).toBeVisible();
    await page.getByLabel("Heading Divider", { exact: true }).check();
    await expect(page.getByLabel("Heading divider level")).toHaveValue("1");
    await page.getByLabel("Heading divider level").selectOption("3");
    await page.getByLabel("Heading Divider", { exact: true }).uncheck();
    await expect(page.getByLabel("Heading divider level")).toBeDisabled();
    await expect(page.getByLabel("Heading divider level")).toHaveValue("3");
    await page.getByLabel("Heading Divider", { exact: true }).check();
    await expect(page.getByLabel("Heading divider level")).toBeEnabled();
    await expect(page.getByLabel("Heading divider level")).toHaveValue("3");

    await expect(page.getByText("1 / 2")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const exported = await readFile(path!, "utf8");
    expect(exported).toContain("headingDivider: 3");
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
    await expect(page.getByText("Turn on Marp in the Slides settings above.")).toBeVisible();
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

    await page.getByRole("button", { name: "Slides" }).click();
    await page.getByLabel("Marp", { exact: true }).check();
    await page.getByRole("button", { name: "Marp settings" }).click();
    await page.getByLabel("Size").selectOption("4:3");
    await page.getByLabel("Theme").selectOption("gaia");
    await page.getByLabel("Page numbers").uncheck();

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
