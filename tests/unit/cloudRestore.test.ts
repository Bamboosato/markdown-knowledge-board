import { describe, expect, it } from "vitest";

import { createBackupDocument } from "../../src/lib/backup";
import {
  buildRestorePlan,
  createNoteFingerprint,
  createNotesFromBackupDocument,
  getNotesToApply,
  parseStrictBackupDocument,
  validateBackupDocument,
} from "../../src/lib/cloudRestore";
import type { FrontmatterValue, Note } from "../../src/lib/types";

type BackupFixture = Record<string, unknown> & {
  notes: Array<Record<string, unknown>>;
};

type InvalidBackupCase = [
  label: string,
  mutate: (backup: BackupFixture) => void,
  expectedMessage: string,
];

function createNote(
  id: string,
  updatedAt: number,
  overrides: Partial<Note> = {}
): Note {
  return {
    id,
    title: `Note ${id}`,
    body: `# Note ${id}\n\nBody ${id}`,
    tags: ["phase2"],
    updatedAt,
    ...overrides,
  };
}

function createValidBackup(
  notes = [createNote("note-1", 100)]
): BackupFixture {
  return JSON.parse(
    JSON.stringify(
      createBackupDocument(notes, "2026-08-03T00:00:00.000Z")
    )
  ) as BackupFixture;
}

function nestedArray(depth: number): FrontmatterValue {
  let value: FrontmatterValue = "leaf";
  for (let index = 0; index < depth; index += 1) {
    value = [value];
  }
  return value;
}

describe("strict cloud backup validation", () => {
  it("validates an empty document without changing its version 1 contract", () => {
    const backup = validateBackupDocument(createValidBackup([]));

    expect(backup).toMatchObject({ version: 1, noteCount: 0, notes: [] });
  });

  it("validates and converts complete wrapper data into notes", () => {
    const source = createNote("note-1", 100, {
      pinnedAt: 90,
      marp: {
        enabled: true,
        theme: "gaia",
        size: "4:3",
        paginate: false,
        headingDivider: 2,
      },
      customMetadata: [{ key: "owner", value: { team: "開発" } }],
    });
    const document = parseStrictBackupDocument(
      JSON.stringify(createBackupDocument([source], "2026-08-03T00:00:00Z"))
    );

    expect(createNotesFromBackupDocument(document)).toEqual([source]);
  });

  const invalidBackupCases: InvalidBackupCase[] = [
    ["unknown root field", (backup) => (backup.extra = true), "unsupported field"],
    ["unsupported version", (backup) => (backup.version = 2), "Unsupported"],
    [
      "invalid UTC timestamp",
      (backup) => (backup.createdAt = "2026-08-03"),
      "ISO 8601",
    ],
    [
      "invalid calendar date",
      (backup) => (backup.createdAt = "2026-02-31T00:00:00Z"),
      "ISO 8601",
    ],
    ["note count mismatch", (backup) => (backup.noteCount = 2), "does not match"],
    [
      "unknown note field",
      (backup) => (backup.notes[0].extra = true),
      "unsupported field",
    ],
    ["missing note title", (backup) => delete backup.notes[0].title, "title"],
    [
      "negative updatedAt",
      (backup) => (backup.notes[0].updatedAt = -1),
      "updatedAt",
    ],
  ];

  it.each(invalidBackupCases)("rejects %s before a restore plan is created", (_label, mutate, message) => {
    const backup = createValidBackup();
    mutate(backup);

    expect(() => validateBackupDocument(backup)).toThrow(message);
  });

  it("rejects duplicate note ids to prevent ambiguous updates", () => {
    const backup = createValidBackup([
      createNote("duplicate", 100),
      createNote("duplicate", 200),
    ]);

    expect(() => validateBackupDocument(backup)).toThrow("duplicate note id");
  });

  it("rejects a wrapper id that conflicts with Markdown frontmatter", () => {
    const backup = createValidBackup();
    backup.notes[0].id = "different-id";

    expect(() => validateBackupDocument(backup)).toThrow(
      "conflicts with the Markdown frontmatter id"
    );
  });

  it.each(["", "title", "__proto__", "prototype", "constructor"])(
    "rejects unsafe or reserved custom metadata key %j",
    (key) => {
      const backup = createValidBackup();
      backup.notes[0].customMetadata = [{ key, value: "value" }];

      expect(() => validateBackupDocument(backup)).toThrow(/key/);
    }
  );

  it("accepts metadata nesting at depth 20 and rejects depth 21", () => {
    const accepted = createValidBackup();
    accepted.notes[0].customMetadata = [
      { key: "nested", value: nestedArray(20) },
    ];
    const rejected = createValidBackup();
    rejected.notes[0].customMetadata = [
      { key: "nested", value: nestedArray(21) },
    ];

    expect(() => validateBackupDocument(accepted)).not.toThrow();
    expect(() => validateBackupDocument(rejected)).toThrow("nesting limit");
  });

  it("accepts 1,000 metadata array items and rejects 1,001", () => {
    const accepted = createValidBackup();
    accepted.notes[0].customMetadata = [
      { key: "items", value: Array.from({ length: 1000 }, () => null) },
    ];
    const rejected = createValidBackup();
    rejected.notes[0].customMetadata = [
      { key: "items", value: Array.from({ length: 1001 }, () => null) },
    ];

    expect(() => validateBackupDocument(accepted)).not.toThrow();
    expect(() => validateBackupDocument(rejected)).toThrow("too many array items");
  });

  it("rejects malformed JSON without exposing a parser-specific error", () => {
    expect(() => parseStrictBackupDocument("{broken")).toThrow(
      "must be valid JSON"
    );
  });
});

describe("safe restore diff", () => {
  it("classifies added, updated, skipped, and conflicted notes in cloud order", async () => {
    const local = [
      createNote("same", 300),
      createNote("cloud-newer", 100, { body: "local" }),
      createNote("local-newer", 300, { body: "local" }),
      createNote("same-time", 200, { body: "local" }),
      createNote("local-only", 500),
    ];
    const cloud = [
      createNote("added", 100),
      createNote("same", 999),
      createNote("cloud-newer", 200, { body: "cloud" }),
      createNote("local-newer", 200, { body: "cloud" }),
      createNote("same-time", 200, { body: "cloud" }),
    ];

    const plan = await buildRestorePlan(local, cloud);

    expect(plan.map(({ id, action, reason }) => ({ id, action, reason }))).toEqual([
      { id: "added", action: "added", reason: "missing-local" },
      { id: "same", action: "skipped", reason: "identical" },
      { id: "cloud-newer", action: "updated", reason: "cloud-newer" },
      { id: "local-newer", action: "conflicted", reason: "local-newer" },
      {
        id: "same-time",
        action: "conflicted",
        reason: "same-timestamp-different-content",
      },
    ]);
    expect(getNotesToApply(plan).map((note) => note.id)).toEqual([
      "added",
      "cloud-newer",
    ]);
    expect(plan.some((item) => item.id === "local-only")).toBe(false);
  });

  it("includes pin, Marp, and custom metadata in content identity", async () => {
    const base = createNote("note-1", 100);
    const variants = [
      createNote("note-1", 100, { pinnedAt: 1 }),
      createNote("note-1", 100, {
        marp: {
          enabled: true,
          theme: "default",
          size: "16:9",
          paginate: true,
          headingDivider: false,
        },
      }),
      createNote("note-1", 100, {
        customMetadata: [{ key: "owner", value: "team" }],
      }),
    ];

    for (const variant of variants) {
      await expect(createNoteFingerprint(variant)).resolves.not.toBe(
        await createNoteFingerprint(base)
      );
    }
  });

  it("canonicalizes nested object key order without reordering arrays", async () => {
    const left = createNote("note-1", 100, {
      customMetadata: [
        { key: "config", value: { alpha: 1, beta: ["x", "y"] } },
      ],
    });
    const right = createNote("note-1", 200, {
      customMetadata: [
        { key: "config", value: { beta: ["x", "y"], alpha: 1 } },
      ],
    });
    const reorderedArray = createNote("note-1", 200, {
      customMetadata: [
        { key: "config", value: { beta: ["y", "x"], alpha: 1 } },
      ],
    });

    await expect(createNoteFingerprint(left)).resolves.toBe(
      await createNoteFingerprint(right)
    );
    await expect(createNoteFingerprint(left)).resolves.not.toBe(
      await createNoteFingerprint(reorderedArray)
    );
  });
});
