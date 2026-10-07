import type { BackupDocument, BackupNoteRecord } from "./backup";
import { canonicalStringify } from "./canonicalJson";
import {
  assertFrontmatterExpansion,
  cloneCustomMetadata,
  parseMarkdownWithFrontmatter,
  RESERVED_FRONTMATTER_KEYS,
  UNSAFE_FRONTMATTER_KEYS,
} from "./frontmatter";
import { createNoteFromMarkdown } from "./note";
import {
  getNoteMarpSettings,
  type CustomMetadataEntry,
  type FrontmatterValue,
  type Note,
} from "./types";

const ROOT_KEYS = new Set(["app", "version", "createdAt", "noteCount", "notes"]);
const NOTE_KEYS = new Set([
  "id",
  "title",
  "tags",
  "updatedAt",
  "pinnedAt",
  "customMetadata",
  "markdown",
]);
const CUSTOM_METADATA_KEYS = new Set(["key", "value"]);
const MAX_METADATA_ITEMS = 1000;
const MAX_METADATA_DEPTH = 20;

export type RestoreAction = "added" | "updated" | "skipped" | "conflicted";

export type RestoreReason =
  | "missing-local"
  | "identical"
  | "cloud-newer"
  | "local-newer"
  | "same-timestamp-different-content";

export type RestorePlanItem = {
  id: string;
  title: string;
  action: RestoreAction;
  localUpdatedAt?: number;
  cloudUpdatedAt: number;
  reason: RestoreReason;
  noteToApply?: Note;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  location: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new Error(`${location} contains an unsupported field: ${unknownKey}.`);
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(
      value
    );
  if (!match || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const date = new Date(value);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  );
}

function validateFrontmatterValue(
  value: unknown,
  location: string,
  depth = 0
): asserts value is FrontmatterValue {
  if (depth > MAX_METADATA_DEPTH) {
    throw new Error(`${location} exceeds the metadata nesting limit.`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${location} must contain only finite numbers.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ITEMS) {
      throw new Error(`${location} contains too many array items.`);
    }
    value.forEach((item, index) =>
      validateFrontmatterValue(item, `${location}[${index}]`, depth + 1)
    );
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`${location} contains an unsupported metadata value.`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_ITEMS) {
    throw new Error(`${location} contains too many object fields.`);
  }
  for (const [key, item] of entries) {
    if (UNSAFE_FRONTMATTER_KEYS.has(key)) {
      throw new Error(`${location} contains an unsafe metadata key: ${key}.`);
    }
    validateFrontmatterValue(item, `${location}.${key}`, depth + 1);
  }
}

function validateCustomMetadata(
  value: unknown,
  location: string
): CustomMetadataEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array.`);
  }
  if (value.length > MAX_METADATA_ITEMS) {
    throw new Error(`${location} contains too many entries.`);
  }

  assertFrontmatterExpansion(value);

  const keys = new Set<string>();
  const entries = value.map((item, index) => {
    const itemLocation = `${location}[${index}]`;
    if (!isPlainRecord(item)) {
      throw new Error(`${itemLocation} must be an object.`);
    }
    assertAllowedKeys(item, CUSTOM_METADATA_KEYS, itemLocation);
    if (typeof item.key !== "string" || item.key.trim().length === 0) {
      throw new Error(`${itemLocation}.key must be a non-empty string.`);
    }
    if (
      RESERVED_FRONTMATTER_KEYS.has(item.key) ||
      UNSAFE_FRONTMATTER_KEYS.has(item.key)
    ) {
      throw new Error(`${itemLocation}.key is not allowed: ${item.key}.`);
    }
    if (keys.has(item.key)) {
      throw new Error(`${location} contains a duplicate key: ${item.key}.`);
    }
    keys.add(item.key);
    validateFrontmatterValue(item.value, `${itemLocation}.value`);
    return { key: item.key, value: item.value as FrontmatterValue };
  });

  return cloneCustomMetadata(entries);
}

function validateBackupNote(
  value: unknown,
  index: number,
  ids: Set<string>
): BackupNoteRecord {
  const location = `Backup note ${index + 1}`;
  if (!isPlainRecord(value)) {
    throw new Error(`${location} must be an object.`);
  }
  assertAllowedKeys(value, NOTE_KEYS, location);
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error(`${location}.id must be a non-empty string.`);
  }
  if (ids.has(value.id)) {
    throw new Error(`Backup contains a duplicate note id: ${value.id}.`);
  }
  ids.add(value.id);
  if (typeof value.title !== "string") {
    throw new Error(`${location}.title must be a string.`);
  }
  if (
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string")
  ) {
    throw new Error(`${location}.tags must be a string array.`);
  }
  if (!isNonNegativeInteger(value.updatedAt)) {
    throw new Error(`${location}.updatedAt must be a non-negative integer.`);
  }
  if (
    Object.hasOwn(value, "pinnedAt") &&
    (typeof value.pinnedAt !== "number" ||
      !Number.isFinite(value.pinnedAt) ||
      value.pinnedAt < 0)
  ) {
    throw new Error(`${location}.pinnedAt must be a non-negative finite number.`);
  }
  if (typeof value.markdown !== "string") {
    throw new Error(`${location}.markdown must be a string.`);
  }

  const parsedMarkdown = parseMarkdownWithFrontmatter(value.markdown);
  if (parsedMarkdown.id !== undefined && parsedMarkdown.id !== value.id) {
    throw new Error(`${location}.id conflicts with the Markdown frontmatter id.`);
  }

  const note: BackupNoteRecord = {
    id: value.id,
    title: value.title,
    tags: [...value.tags],
    updatedAt: value.updatedAt,
    markdown: value.markdown,
  };
  if (Object.hasOwn(value, "pinnedAt")) {
    note.pinnedAt = value.pinnedAt as number;
  }
  if (Object.hasOwn(value, "customMetadata")) {
    note.customMetadata = validateCustomMetadata(
      value.customMetadata,
      `${location}.customMetadata`
    );
  }
  return note;
}

export function validateBackupDocument(value: unknown): BackupDocument {
  if (!isPlainRecord(value)) {
    throw new Error("Backup document must be an object.");
  }
  assertAllowedKeys(value, ROOT_KEYS, "Backup document");
  if (value.app !== "markdown-knowledge-board" || value.version !== 1) {
    throw new Error("Unsupported backup format.");
  }
  if (!isIsoUtc(value.createdAt)) {
    throw new Error("Backup document createdAt must be an ISO 8601 UTC string.");
  }
  if (!isNonNegativeInteger(value.noteCount)) {
    throw new Error("Backup document noteCount must be a non-negative integer.");
  }
  if (!Array.isArray(value.notes)) {
    throw new Error("Backup document notes must be an array.");
  }
  if (value.noteCount !== value.notes.length) {
    throw new Error("Backup document noteCount does not match notes.length.");
  }

  const ids = new Set<string>();
  return {
    app: "markdown-knowledge-board",
    version: 1,
    createdAt: value.createdAt,
    noteCount: value.noteCount,
    notes: value.notes.map((note, index) =>
      validateBackupNote(note, index, ids)
    ),
  };
}

export function parseStrictBackupDocument(content: string): BackupDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Backup document must be valid JSON.");
  }
  return validateBackupDocument(parsed);
}

export function createNotesFromBackupDocument(
  document: BackupDocument,
  fileName = "cloud-backup.json"
): Note[] {
  return document.notes.map((item, index) =>
    createNoteFromMarkdown(item.markdown, `${fileName}#${index + 1}`, {
      id: item.id,
      title: item.title,
      tags: [...item.tags],
      updatedAt: item.updatedAt,
      pinnedAt: item.pinnedAt,
      customMetadata: cloneCustomMetadata(item.customMetadata),
    })
  );
}

function comparableNote(note: Note): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    tags: [...note.tags],
    pinnedAt: note.pinnedAt ?? null,
    marp: getNoteMarpSettings(note),
    customMetadata: cloneCustomMetadata(note.customMetadata),
  };
}

export async function createNoteFingerprint(note: Note): Promise<string> {
  const canonicalJson = canonicalStringify(comparableNote(note));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function cloneNote(note: Note): Note {
  return {
    ...note,
    tags: [...note.tags],
    marp: note.marp ? { ...note.marp } : undefined,
    customMetadata: cloneCustomMetadata(note.customMetadata),
  };
}

export async function buildRestorePlan(
  localNotes: Note[],
  cloudNotes: Note[]
): Promise<RestorePlanItem[]> {
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const fingerprintCache = new Map<Note, Promise<string>>();
  const fingerprint = (note: Note) => {
    let pending = fingerprintCache.get(note);
    if (!pending) {
      pending = createNoteFingerprint(note);
      fingerprintCache.set(note, pending);
    }
    return pending;
  };

  return Promise.all(
    cloudNotes.map(async (cloudNote): Promise<RestorePlanItem> => {
      const localNote = localById.get(cloudNote.id);
      if (!localNote) {
        return {
          id: cloudNote.id,
          title: cloudNote.title,
          action: "added",
          cloudUpdatedAt: cloudNote.updatedAt,
          reason: "missing-local",
          noteToApply: cloneNote(cloudNote),
        };
      }

      const [localFingerprint, cloudFingerprint] = await Promise.all([
        fingerprint(localNote),
        fingerprint(cloudNote),
      ]);
      if (localFingerprint === cloudFingerprint) {
        return {
          id: cloudNote.id,
          title: cloudNote.title,
          action: "skipped",
          localUpdatedAt: localNote.updatedAt,
          cloudUpdatedAt: cloudNote.updatedAt,
          reason: "identical",
        };
      }
      if (cloudNote.updatedAt > localNote.updatedAt) {
        return {
          id: cloudNote.id,
          title: cloudNote.title,
          action: "updated",
          localUpdatedAt: localNote.updatedAt,
          cloudUpdatedAt: cloudNote.updatedAt,
          reason: "cloud-newer",
          noteToApply: cloneNote(cloudNote),
        };
      }
      return {
        id: cloudNote.id,
        title: cloudNote.title,
        action: "conflicted",
        localUpdatedAt: localNote.updatedAt,
        cloudUpdatedAt: cloudNote.updatedAt,
        reason:
          cloudNote.updatedAt < localNote.updatedAt
            ? "local-newer"
            : "same-timestamp-different-content",
      };
    })
  );
}

export function getNotesToApply(plan: RestorePlanItem[]): Note[] {
  return plan.flatMap((item) => (item.noteToApply ? [item.noteToApply] : []));
}
