import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Note } from "./types";

interface MarkdownDbSchema extends DBSchema {
  notes: {
    key: string;
    value: Note;
  };
}

const DB_NAME = "markdown-knowledge-board";
const DB_VERSION = 1;
const STORE_NAME = "notes";

let dbPromise: Promise<IDBPDatabase<MarkdownDbSchema>> | null = null;
export let dbInitError: string | null = null;

async function getDb(): Promise<IDBPDatabase<MarkdownDbSchema> | undefined> {
  if (!dbPromise) {
    dbPromise = openDB<MarkdownDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      },
    });
  }

  try {
    return await dbPromise;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open IndexedDB.";
    dbInitError = message;
    console.error("IndexedDB init failed:", error);
    return undefined;
  }
}

function createDbUnavailableError(): Error {
  return new Error(dbInitError ?? "IndexedDB is unavailable.");
}

async function requireDb(): Promise<IDBPDatabase<MarkdownDbSchema>> {
  const db = await getDb();
  if (!db) {
    throw createDbUnavailableError();
  }
  return db;
}

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDb();
  if (!db) {
    return [];
  }
  return db.getAll(STORE_NAME);
}

export async function getNote(id: string): Promise<Note | undefined> {
  const db = await getDb();
  if (!db) {
    return undefined;
  }
  return db.get(STORE_NAME, id);
}

export async function saveNote(note: Note): Promise<void> {
  const db = await requireDb();
  await db.put(STORE_NAME, note);
}

// Atomic create-only path for local MCP retries. Never overwrites an existing note.
export async function addNewNoteOrReuse(note: Note): Promise<{ note: Note; reused: boolean }> {
  const db = await requireDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  try {
    const existing = await transaction.store.get(note.id);
    if (existing) {
      await transaction.done;
      const comparable = (value: Note) => JSON.stringify([
        value.title, value.body, value.tags, value.marp, value.customMetadata,
      ]);
      if (comparable(existing) !== comparable(note)) {
        throw new Error("This request ID already exists with different content or the note has been edited. Nothing was overwritten.");
      }
      return { note: existing, reused: true };
    }
    await transaction.store.add(note);
    await transaction.done;
    return { note, reused: false };
  } catch (error) {
    try { transaction.abort(); } catch { /* May already be complete. */ }
    try { await transaction.done; } catch { /* Preserve the original error. */ }
    throw error;
  }
}

export async function deleteNote(id: string): Promise<void> {
  const db = await requireDb();
  await db.delete(STORE_NAME, id);
}

export async function applyNotesTransaction(notes: Note[]): Promise<void> {
  const db = await requireDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  try {
    for (const note of notes) {
      await transaction.store.put(note);
    }
    await transaction.done;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already be aborted by the failed request.
    }
    try {
      await transaction.done;
    } catch {
      // Preserve the original write error after rollback completes.
    }
    throw error;
  }
}
