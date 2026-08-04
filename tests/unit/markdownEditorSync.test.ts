import { describe, expect, it } from "vitest";
import {
  clampEditorOffset,
  findMinimalEditorChange,
} from "../../src/lib/markdownEditorSync";

describe("Markdown editor synchronization", () => {
  it("normal: emits only the changed middle range", () => {
    expect(findMinimalEditorChange("before old after", "before new after")).toEqual(
      {
        from: 7,
        to: 10,
        insert: "new",
      },
    );
  });

  it("boundary: distinguishes no-op, whole deletion, and end insertion", () => {
    expect(findMinimalEditorChange("same", "same")).toBeNull();
    expect(findMinimalEditorChange("all", "")).toEqual({
      from: 0,
      to: 3,
      insert: "",
    });
    expect(findMinimalEditorChange("body", "body\n")).toEqual({
      from: 4,
      to: 4,
      insert: "\n",
    });
  });

  it("data boundary: replaces a complete surrogate pair when emoji differ", () => {
    expect(findMinimalEditorChange("😀 text", "😃 text")).toEqual({
      from: 0,
      to: 2,
      insert: "😃",
    });
  });

  it("invalid boundary: clamps stale selection offsets to the current document", () => {
    expect(clampEditorOffset(-5, 10)).toBe(0);
    expect(clampEditorOffset(4, 10)).toBe(4);
    expect(clampEditorOffset(20, 10)).toBe(10);
  });
});
