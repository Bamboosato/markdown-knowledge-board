import { cloneCustomMetadata, parseMarkdownWithFrontmatter } from "./frontmatter";
import type { Note } from "./types";

function extractTitle(content: string, fallback: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^#\s+(.+)$/.exec(trimmed);
    if (match) {
      return match[1].trim();
    }
  }
  return fallback || "Untitled";
}

function filenameToTitle(name: string): string {
  return name.replace(/\.(?:md|markdown|txt)$/i, "").trim();
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${getCurrentTimestamp()}-${Math.random().toString(16).slice(2)}`;
}

export function getCurrentTimestamp(): number {
  return Date.now();
}

export function getPinnedAt(
  note: Pick<Note, "pinnedAt">
): number | undefined {
  return typeof note.pinnedAt === "number" &&
    Number.isFinite(note.pinnedAt) &&
    note.pinnedAt >= 0
    ? note.pinnedAt
    : undefined;
}

export function createNoteFromMarkdown(
  content: string,
  fileName: string,
  overrides?: Partial<
    Pick<
      Note,
      "id" | "title" | "tags" | "updatedAt" | "pinnedAt" | "customMetadata"
    >
  >,
  preferFileNameTitle = false
): Note {
  if (content.trim().length === 0) {
    throw new Error("File is empty.");
  }

  const parsed = parseMarkdownWithFrontmatter(content);
  const fallbackTitle = filenameToTitle(fileName);
  const body = parsed.body ?? content;
  const title =
    overrides?.title ??
    parsed.title ??
    (preferFileNameTitle ? fallbackTitle : extractTitle(body, fallbackTitle));

  return {
    id: overrides?.id ?? parsed.id ?? createId(),
    title: title.trim() || "Untitled",
    body,
    tags: overrides?.tags ?? parsed.tags ?? [],
    updatedAt:
      overrides?.updatedAt ?? parsed.updatedAt ?? getCurrentTimestamp(),
    pinnedAt: overrides?.pinnedAt,
    marp: parsed.marp,
    customMetadata:
      overrides?.customMetadata ?? cloneCustomMetadata(parsed.customMetadata),
  };
}
