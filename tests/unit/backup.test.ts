import { describe, expect, it } from "vitest";

import {
  createBackupDocument,
  parseBackupNotes,
  parseImportFileContent,
  parseMarkdownBodyFileContent,
} from "../../src/lib/backup";
import type { FrontmatterValue, Note } from "../../src/lib/types";

function createCompleteNote(): Note {
  return {
    id: "note-1",
    title: "Phase 2",
    body: "# Phase 2\n\n本文 👋",
    tags: ["Backup", "日本語"],
    updatedAt: 1_700_000_000_000,
    pinnedAt: 1_700_000_000_100,
    marp: {
      enabled: true,
      theme: "gaia",
      size: "4:3",
      paginate: false,
      headingDivider: 2,
    },
    customMetadata: [
      { key: "owner", value: "開発" },
      {
        key: "review",
        value: { approved: true, scores: [1, 2, 3] },
      },
    ],
  };
}

describe("local backup version 1", () => {
  it("roundtrips pinned, Marp, custom metadata, and Unicode data", () => {
    const note = createCompleteNote();
    const backup = createBackupDocument([note], "2026-08-03T00:00:00.000Z");

    expect(backup.noteCount).toBe(1);
    expect(backup.notes[0]).toMatchObject({
      id: note.id,
      title: note.title,
      tags: note.tags,
      updatedAt: note.updatedAt,
      pinnedAt: note.pinnedAt,
      customMetadata: note.customMetadata,
    });

    const [restored] = parseBackupNotes(
      JSON.stringify(backup),
      "phase2-backup.json"
    );
    expect(restored).toEqual(note);
  });

  it("creates an empty backup without changing the version 1 envelope", () => {
    expect(createBackupDocument([], "2026-08-03T00:00:00.000Z")).toEqual({
      app: "markdown-knowledge-board",
      version: 1,
      createdAt: "2026-08-03T00:00:00.000Z",
      noteCount: 0,
      notes: [],
    });
  });

  it("accepts an older version 1 note without pinned or custom metadata", () => {
    const [note] = parseBackupNotes(
      JSON.stringify({
        app: "markdown-knowledge-board",
        version: 1,
        createdAt: "2026-08-03T00:00:00.000Z",
        noteCount: 1,
        notes: [
          {
            id: "legacy-note",
            title: "Legacy",
            tags: [],
            updatedAt: 123,
            markdown: "# Legacy\n\nBody",
          },
        ],
      }),
      "legacy.json"
    );

    expect(note).toMatchObject({
      id: "legacy-note",
      title: "Legacy",
      body: "# Legacy\n\nBody",
      tags: [],
      updatedAt: 123,
      pinnedAt: undefined,
      customMetadata: [],
    });
  });

  it.each([
    ["array root", "[]", "Unsupported backup format."],
    [
      "unknown version",
      JSON.stringify({ app: "markdown-knowledge-board", version: 2, notes: [] }),
      "Unsupported backup format.",
    ],
    [
      "missing notes",
      JSON.stringify({ app: "markdown-knowledge-board", version: 1 }),
      "Backup file does not contain a notes array.",
    ],
    [
      "invalid note",
      JSON.stringify({
        app: "markdown-knowledge-board",
        version: 1,
        notes: [null],
      }),
      "Backup note 1 is invalid.",
    ],
    [
      "missing Markdown",
      JSON.stringify({
        app: "markdown-knowledge-board",
        version: 1,
        notes: [{}],
      }),
      "Backup note 1 is missing Markdown content.",
    ],
  ])("rejects %s", (_name, content, message) => {
    expect(() => parseBackupNotes(content, "invalid.json")).toThrow(message);
  });

  it("rejects custom metadata beyond the current nesting limit", () => {
    let value: FrontmatterValue = "leaf";
    for (let index = 0; index < 22; index += 1) {
      value = { nested: value };
    }
    const note = createCompleteNote();
    note.customMetadata = [{ key: "tooDeep", value }];

    expect(() =>
      createBackupDocument([note], "2026-08-03T00:00:00.000Z")
    ).toThrow("Metadata nesting is too deep.");
  });

  it("keeps import file type checks separate for Markdown and JSON", () => {
    expect(() =>
      parseImportFileContent("{}", "backup.txt", "backup")
    ).toThrow("Only .json backup files can be imported here.");
    expect(() =>
      parseImportFileContent("# Note", "note.json", "markdown")
    ).toThrow("Only .md, .markdown, and .txt files can be imported here.");
  });

  it("assigns a fresh ID when Markdown frontmatter contains an existing ID", () => {
    const markdown = [
      "---",
      "id: existing-note",
      "title: Imported title",
      "updatedAt: 1700000000000",
      "tags:",
      "  - Imported",
      "---",
      "# Imported body",
    ].join("\n");

    const [first] = parseImportFileContent(markdown, "import.md", "markdown");
    const [second] = parseImportFileContent(markdown, "import.md", "markdown");

    expect(first).toMatchObject({
      title: "Imported title",
      body: "# Imported body",
      tags: ["Imported"],
      updatedAt: 1_700_000_000_000,
    });
    expect(first.id).not.toBe("existing-note");
    expect(second.id).not.toBe("existing-note");
    expect(second.id).not.toBe(first.id);
  });

  it("extracts only the Markdown body when replacing a current note", () => {
    const body = parseMarkdownBodyFileContent(
      [
        "---",
        "id: ignored-id",
        "title: Ignored title",
        "tags:",
        "  - Ignored",
        "---",
        "# Replacement body",
      ].join("\n"),
      "replacement.markdown"
    );

    expect(body).toBe("# Replacement body");
  });

  it("rejects an empty replacement file and unsupported extension", () => {
    expect(() => parseMarkdownBodyFileContent("  \n", "empty.md")).toThrow(
      "File is empty."
    );
    expect(() => parseMarkdownBodyFileContent("Body", "note.json")).toThrow(
      "Only .md, .markdown, and .txt files can be imported here."
    );
  });

  it("does not reuse an embedded Markdown ID when a backup record has no ID", () => {
    const [note] = parseBackupNotes(
      JSON.stringify({
        app: "markdown-knowledge-board",
        version: 1,
        notes: [
          {
            markdown: "---\nid: embedded-id\n---\n# Backup body",
          },
        ],
      }),
      "missing-id.json"
    );

    expect(note.id).not.toBe("embedded-id");
    expect(note.body).toBe("# Backup body");
  });
});
