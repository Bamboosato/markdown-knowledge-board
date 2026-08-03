import {
  cloneCustomMetadata,
  toMarkdownWithFrontmatter,
} from "./frontmatter";
import { createNoteFromMarkdown, getPinnedAt } from "./note";
import type { CustomMetadataEntry, Note } from "./types";

export type BackupDocument = {
  app: "markdown-knowledge-board";
  version: 1;
  createdAt: string;
  noteCount: number;
  notes: Array<{
    id: string;
    title: string;
    tags: string[];
    updatedAt: number;
    pinnedAt?: number;
    customMetadata?: CustomMetadataEntry[];
    markdown: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createBackupDocument(
  notes: Note[],
  createdAt: string
): BackupDocument {
  return {
    app: "markdown-knowledge-board",
    version: 1,
    createdAt,
    noteCount: notes.length,
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      tags: note.tags,
      updatedAt: note.updatedAt,
      pinnedAt: getPinnedAt(note),
      customMetadata: cloneCustomMetadata(note.customMetadata),
      markdown: toMarkdownWithFrontmatter(note),
    })),
  };
}

export function parseBackupNotes(content: string, fileName: string): Note[] {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error("Backup file must be a JSON object.");
  }
  if (parsed.app !== "markdown-knowledge-board" || parsed.version !== 1) {
    throw new Error("Unsupported backup format.");
  }
  if (!Array.isArray(parsed.notes)) {
    throw new Error("Backup file does not contain a notes array.");
  }

  return parsed.notes.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Backup note ${index + 1} is invalid.`);
    }
    if (typeof item.markdown !== "string") {
      throw new Error(`Backup note ${index + 1} is missing Markdown content.`);
    }

    const id = typeof item.id === "string" ? item.id : undefined;
    const title = typeof item.title === "string" ? item.title : undefined;
    const tags =
      Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string")
        ? item.tags
        : undefined;
    const updatedAt =
      typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
        ? item.updatedAt
        : undefined;
    const pinnedAt =
      typeof item.pinnedAt === "number" &&
      Number.isFinite(item.pinnedAt) &&
      item.pinnedAt >= 0
        ? item.pinnedAt
        : undefined;
    const customMetadata = Array.isArray(item.customMetadata)
      ? cloneCustomMetadata(item.customMetadata as CustomMetadataEntry[])
      : undefined;

    return createNoteFromMarkdown(item.markdown, `${fileName}#${index + 1}`, {
      id,
      title,
      tags,
      updatedAt,
      pinnedAt,
      customMetadata,
    });
  });
}

export function parseImportFileContent(
  content: string,
  fileName: string,
  importKind: "markdown" | "backup"
): Note[] {
  if (importKind === "backup") {
    if (!/\.json$/i.test(fileName)) {
      throw new Error("Only .json backup files can be imported here.");
    }
    return parseBackupNotes(content, fileName);
  }
  if (!/\.(?:md|markdown|txt)$/i.test(fileName)) {
    throw new Error("Only .md, .markdown, and .txt files can be imported here.");
  }
  return [createNoteFromMarkdown(content, fileName, undefined, true)];
}
