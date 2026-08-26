import { describe, expect, it } from "vitest";
import type { Note } from "../../src/lib/types";
import {
  buildTagSuggestionCandidates,
  getTagSuggestions,
} from "../../src/lib/tagSuggestions";

function note(
  id: string,
  tags: string[],
  updatedAt: number,
): Note {
  return { id, title: id, body: "", tags, updatedAt };
}

describe("tag suggestions", () => {
  it("function: prioritizes tags from the most recently updated note", () => {
    const notes = [
      note("old", ["zeta", "shared"], 100),
      note("recent", ["alpha", "SHARED"], 200),
    ];

    expect(getTagSuggestions(notes, [], "", 8)).toEqual([
      "alpha",
      "shared",
      "zeta",
    ]);
  });

  it("data: deduplicates tags case-insensitively and retains the first display spelling", () => {
    const notes = [
      note("first", ["  Project  "], 100),
      note("second", ["project"], 200),
    ];

    expect(buildTagSuggestionCandidates(notes)).toEqual([
      { tag: "  Project  ", lastUsedAt: 200 },
    ]);
  });

  it("UI boundary: filters before applying the eight-item limit", () => {
    const notes = Array.from({ length: 10 }, (_, index) =>
      note(`note-${index}`, [`tag-${index}`], 1_000 - index),
    );

    expect(getTagSuggestions(notes, [], "tag-", 8)).toEqual([
      "tag-0",
      "tag-1",
      "tag-2",
      "tag-3",
      "tag-4",
      "tag-5",
      "tag-6",
      "tag-7",
    ]);
  });

  it("state: excludes already selected tags regardless of case or surrounding spaces", () => {
    const notes = [
      note("one", ["Alpha"], 300),
      note("two", ["beta"], 200),
    ];

    expect(getTagSuggestions(notes, [" alpha "], "", 8)).toEqual(["beta"]);
  });

  it("boundary: falls back to tag-name order when update times are equal", () => {
    const notes = [
      note("one", ["zeta"], 100),
      note("two", ["alpha"], 100),
    ];

    expect(getTagSuggestions(notes, [], "", 8)).toEqual(["alpha", "zeta"]);
  });
});
