import { describe, expect, it } from "vitest";
import {
  CONTENT_FONT_SCALE_DEFAULT,
  CONTENT_FONT_SCALE_STORAGE_KEY,
  getNextContentFontScale,
  normalizeContentFontScale,
  readContentFontScale,
} from "../../src/lib/contentFontScale";

describe("content font scale", () => {
  it("normal: changes one 10% step in the wheel direction", () => {
    expect(getNextContentFontScale(100, -100)).toBe(110);
    expect(getNextContentFontScale(110, 100)).toBe(100);
  });

  it("boundary: clamps repeated changes to 80% through 180%", () => {
    expect(getNextContentFontScale(80, 100)).toBe(80);
    expect(getNextContentFontScale(180, -100)).toBe(180);
    expect(normalizeContentFontScale(1)).toBe(80);
    expect(normalizeContentFontScale(999)).toBe(180);
  });

  it("data boundary: rounds finite persisted values to the nearest step", () => {
    expect(normalizeContentFontScale("124")).toBe(120);
    expect(normalizeContentFontScale("126")).toBe(130);
    expect(normalizeContentFontScale("180")).toBe(180);
  });

  it("invalid: falls back to 100% for unknown or unreadable storage", () => {
    expect(normalizeContentFontScale("")).toBe(CONTENT_FONT_SCALE_DEFAULT);
    expect(normalizeContentFontScale("large")).toBe(
      CONTENT_FONT_SCALE_DEFAULT,
    );
    expect(normalizeContentFontScale(Number.NaN)).toBe(
      CONTENT_FONT_SCALE_DEFAULT,
    );
    expect(
      readContentFontScale({
        getItem() {
          throw new DOMException("blocked");
        },
      }),
    ).toBe(CONTENT_FONT_SCALE_DEFAULT);
  });

  it("state restore: reads only the versioned display preference", () => {
    const storage = {
      getItem(key: string) {
        return key === CONTENT_FONT_SCALE_STORAGE_KEY ? "140" : null;
      },
    };

    expect(readContentFontScale(storage)).toBe(140);
  });
});
