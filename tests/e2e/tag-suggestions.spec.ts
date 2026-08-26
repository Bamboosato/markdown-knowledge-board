import { expect, test } from "@playwright/test";

type StoredNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
};

const suggestionNotes: StoredNote[] = [
  {
    id: "older-note",
    title: "Older note",
    body: "Older body",
    tags: ["older-tag", "shared-tag"],
    updatedAt: Date.UTC(2026, 7, 20),
  },
  {
    id: "recent-note",
    title: "Recent note",
    body: "Recent body",
    tags: ["recent-tag", "shared-tag"],
    updatedAt: Date.UTC(2026, 7, 25),
  },
  {
    id: "middle-note",
    title: "Middle note",
    body: "Middle body",
    tags: ["middle-tag"],
    updatedAt: Date.UTC(2026, 7, 22),
  },
];

async function seedNotes(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(async (items) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("markdown-knowledge-board", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("notes", "readwrite");
    const store = transaction.objectStore("notes");
    for (const item of items) {
      store.put(item);
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, suggestionNotes);
  await page.reload();
  await expect(page.getByText("Recent note")).toBeVisible();
}

test.describe("tag suggestion ordering", () => {
  test("editor suggestions prioritize tags from the most recently updated note", async ({
    page,
  }) => {
    await seedNotes(page);

    await page.getByRole("button", { name: /new note/i }).click();
    const tagsInput = page.getByLabel("Tags");
    await tagsInput.focus();

    await expect(
      page.getByRole("listbox", { name: "Tag suggestions" }).getByRole("option"),
    ).toHaveText(["recent-tag", "shared-tag", "middle-tag", "older-tag"]);
  });

  test("filter suggestions use the same recent-tag ordering", async ({ page }) => {
    await seedNotes(page);

    await page.getByRole("button", { name: /^Filter$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Filter notes" });
    const tagsInput = dialog.getByRole("combobox", { name: "Tags" });
    await tagsInput.focus();

    await expect(
      dialog
        .getByRole("listbox", { name: "Filter tag suggestions" })
        .getByRole("option"),
    ).toHaveText(["recent-tag", "shared-tag", "middle-tag", "older-tag"]);
  });
});
