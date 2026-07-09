import { expect, test } from "@playwright/test";

test.describe("Phase 1 mobile workflow", () => {
  test("keeps draft, save, preview, and unsaved transitions reachable", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /new note/i }).click();
    await expect(
      page.getByRole("heading", { name: "Markdown Knowledge Board" })
    ).toBeVisible();
    await expect(page.getByText("Status: Draft")).toBeVisible();

    await page.getByLabel("Title").fill("Phase 1 mobile note");
    await page
      .getByLabel("Body")
      .fill("# Phase 1\n\n- [ ] Verify mobile editor");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Status: Saved")).toBeVisible();

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { name: "Phase 1" })).toBeVisible();

    await page.getByRole("button", { name: "Notes" }).click();
    await expect(
      page.getByRole("button", { name: /new note/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Phase 1 mobile note/ })
    ).toBeVisible();

    await page.getByRole("button", { name: /Phase 1 mobile note/ }).click();
    await expect(page.getByLabel("Body")).toBeVisible();
    await page.getByLabel("Body").fill("# Phase 1\n\nChanged but not saved");
    await page.getByRole("button", { name: "Notes" }).click();

    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save and Continue" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Discard and Continue" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 1\n\nChanged but not saved"
    );

    await page.getByRole("button", { name: "Notes" }).click();
    await page.getByRole("button", { name: "Discard and Continue" }).click();
    await expect(
      page.getByRole("button", { name: /new note/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /Phase 1 mobile note/ }).click();
    await expect(page.getByLabel("Body")).toHaveValue(
      "# Phase 1\n\n- [ ] Verify mobile editor"
    );
  });
});
