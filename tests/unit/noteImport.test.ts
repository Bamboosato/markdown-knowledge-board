import { describe, expect, it } from "vitest";

import { findNoteIndexById, replaceNoteBody } from "../../src/lib/noteImport";
import type { Note } from "../../src/lib/types";

function createCurrentNote(): Note {
  return {
    id: "current-note",
    title: "Current title",
    body: "# Old body",
    tags: ["Keep"],
    updatedAt: 100,
    pinnedAt: 90,
    marp: {
      enabled: true,
      theme: "gaia",
      size: "4:3",
      paginate: false,
      headingDivider: 2,
    },
    customMetadata: [{ key: "owner", value: "Current owner" }],
  };
}

describe("current note Markdown import", () => {
  it("matches backup notes by ID only", () => {
    const notes = [
      createCurrentNote(),
      {
        ...createCurrentNote(),
        id: "other-note",
        title: "Current title",
      },
    ];

    expect(findNoteIndexById(notes, "other-note")).toBe(1);
    expect(findNoteIndexById(notes, "missing-note")).toBe(-1);
  });

  it("replaces only the body and updatedAt while preserving all metadata", () => {
    const current = createCurrentNote();
    const replaced = replaceNoteBody(current, "# New body", 200);

    expect(replaced).toEqual({
      ...current,
      body: "# New body",
      updatedAt: 200,
    });
    expect(current.body).toBe("# Old body");
    expect(current.updatedAt).toBe(100);
  });

  it("skips a replacement when the body is unchanged", () => {
    const current = createCurrentNote();

    expect(replaceNoteBody(current, current.body, 200)).toBeNull();
  });
});
