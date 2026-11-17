import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Note } from "./types";
import { assertSnapshot, NoteAccessError } from './noteRevision';
import { notifyNotesChanged } from './noteEvents';

export type UpdateReceipt = { key: string; digest: string; result: {
  status: 'updated' | 'unchanged'; id: string; title: string; previous_revision: string;
  revision: string; updated_at: number; reused: boolean;
} };

interface MarkdownDbSchema extends DBSchema {
  mcpReceipts: { key: string; value: UpdateReceipt };
  notes: {
    key: string;
    value: Note;
  };
}

const DB_NAME = "markdown-knowledge-board";
const DB_VERSION = 2;
const STORE_NAME = "notes";

let dbPromise: Promise<IDBPDatabase<MarkdownDbSchema>> | null = null;
export let dbInitError: string | null = null;

async function getDb(): Promise<IDBPDatabase<MarkdownDbSchema> | undefined> {
  if (!dbPromise) {
    dbPromise = openDB<MarkdownDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('mcpReceipts')) db.createObjectStore('mcpReceipts', { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      },
      blocked() { dbInitError = 'Close other MKB windows, then reload to finish updating storage.'; if (typeof window !== 'undefined') window.dispatchEvent(new Event('mkb-storage-blocked')); },
      blocking() { void dbPromise?.then(db => db.close()); dbPromise = null; },
    });
  }

  try {
    const db = await dbPromise;
    dbInitError = null;
    return db;
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

export async function requireDb(): Promise<IDBPDatabase<MarkdownDbSchema>> {
  const db = await getDb();
  if (!db) {
    throw new NoteAccessError('STORAGE_UNAVAILABLE', createDbUnavailableError().message);
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

export async function saveNote(note: Note, expected: Note | null = null): Promise<void> {
  await applyNotesTransaction([note], expected ? [expected] : []);
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

export async function deleteNote(id: string, expected: Note): Promise<void> {
  const db = await requireDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  try {
    assertSnapshot(await tx.store.get(id), expected);
    await tx.store.delete(id);
    await tx.done;
    notifyNotesChanged();
  } catch (error) { try { tx.abort(); } catch { /* finished */ } await tx.done.catch(() => {}); throw error; }
}

export async function applyNotesTransaction(notes: Note[], expected: Note[] = []): Promise<void> {
  const db = await requireDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  try {
    for (const note of notes) {
      assertSnapshot(await transaction.store.get(note.id), expected.find(item => item.id === note.id) ?? null);
      await transaction.store.put(note);
    }
    await transaction.done;
    notifyNotesChanged();
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
