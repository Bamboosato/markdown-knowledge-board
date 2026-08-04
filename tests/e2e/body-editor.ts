import { expect, type Locator, type Page } from "@playwright/test";

export function getBodyEditor(page: Page) {
  return page.getByRole("textbox", { name: "Body" });
}

export async function readBodyEditorValue(body: Locator) {
  return body.evaluate((element) => {
    const editor = element as HTMLElement & { value?: string };
    if (typeof editor.value !== "string") {
      throw new Error("Body editor value bridge is unavailable");
    }
    return editor.value;
  });
}

export async function expectBodyEditorValue(
  body: Locator,
  expected: string | RegExp,
) {
  const value = () => readBodyEditorValue(body);
  if (typeof expected === "string") {
    await expect.poll(value).toBe(expected);
  } else {
    await expect.poll(value).toMatch(expected);
  }
}
