import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Note } from "./types";
import { assertSnapshot, canonical, NoteAccessError } from './noteRevision';
import { notifyNotesChanged } from './noteEvents';
import { mergeNoteOrder, noteGroup, sortNotes, updateOrderMembership, type NoteGroup, type NoteOrder } from './noteOrder';
import type { MetadataApplyResult } from './localMcpMetadata';

export type UpdateReceipt = { key: string; digest: string; result: {
  status: 'updated' | 'unchanged'; id: string; title: string; previous_revision: string;
  revision: string; updated_at: number; reused: boolean; replacement_count?: number;
} };
export type MetadataReceipt = { key: string; digest: string; result: MetadataApplyResult };
export type McpReceipt = UpdateReceipt | MetadataReceipt;

interface MarkdownDbSchema extends DBSchema {
  noteOrder: { key: string; value: NoteOrder };
  mcpReceipts: { key: string; value: McpReceipt };
  notes: {
    key: string;
    value: Note;
  };
}

const DB_NAME = "markdown-knowledge-board";
const DB_VERSION = 3;
const STORE_NAME = "notes";

let dbPromise: Promise<IDBPDatabase<MarkdownDbSchema>> | null = null;
export let dbInitError: string | null = null;

async function getDb(): Promise<IDBPDatabase<MarkdownDbSchema> | undefined> {
  if (!dbPromise) {
    dbPromise = openDB<MarkdownDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('noteOrder')) db.createObjectStore('noteOrder');
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

export async function getBoard() {
  const db = await requireDb();
  const tx = db.transaction(['notes', 'noteOrder']);
  const [notes, order] = await Promise.all([
    tx.objectStore('notes').getAll(), tx.objectStore('noteOrder').get('groups'),
  ]);
  return { notes, order: order ?? {} };
}

export async function moveNote(group: NoteGroup, expected: string[], id: string, targetId: string) {
  const db = await requireDb();
  const tx = db.transaction(['notes', 'noteOrder'], 'readwrite');
  const store = tx.objectStore('noteOrder');
  const order = await store.get('groups') ?? {};
  const ids = sortNotes(await tx.objectStore('notes').getAll(), order)
    .filter(note => noteGroup(note) === group).map(note => note.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || ids.length !== expected.length || ids.some((item, i) => item !== expected[i])) {
    throw new Error('The note list changed. Try moving the card again.');
  }
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  order[group] = ids;
  await store.put(order, 'groups');
  await tx.done;
  notifyNotesChanged();
  return order;
}

export async function saveNote(note: Note, expected: Note | null = null): Promise<void> {
  await applyNotesTransaction([note], expected ? [expected] : []);
}

// Atomic create-only path for local MCP retries. Never overwrites an existing note.
export async function addNewNoteOrReuse(note: Note): Promise<{ note: Note; reused: boolean }> {
  const db = await requireDb();
  const transaction = db.transaction([STORE_NAME, 'noteOrder'], "readwrite");
  const notes = transaction.objectStore(STORE_NAME);
  try {
    const existing = await notes.get(note.id);
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
    await notes.add(note);
    const orderStore = transaction.objectStore('noteOrder');
    const order = await orderStore.get('groups');
    if (order?.[noteGroup(note)]) {
      updateOrderMembership(order, undefined, note);
      await orderStore.put(order, 'groups');
    }
    await transaction.done;
    notifyNotesChanged();
    return { note, reused: false };
  } catch (error) {
    try { transaction.abort(); } catch { /* May already be complete. */ }
    try { await transaction.done; } catch { /* Preserve the original error. */ }
    throw error;
  }
}

export async function deleteNote(id: string, expected: Note): Promise<void> {
  const db = await requireDb();
  const tx = db.transaction([STORE_NAME, 'noteOrder'], 'readwrite');
  try {
    const notes = tx.objectStore(STORE_NAME);
    assertSnapshot(await notes.get(id), expected);
    await notes.delete(id);
    const orderStore = tx.objectStore('noteOrder');
    const order = await orderStore.get('groups');
    if (order?.[noteGroup(expected)]) {
      updateOrderMembership(order, expected);
      await orderStore.put(order, 'groups');
    }
    await tx.done;
    notifyNotesChanged();
  } catch (error) { try { tx.abort(); } catch { /* finished */ } await tx.done.catch(() => {}); throw error; }
}

export async function applyNotesTransaction(notes: Note[], expected: Note[] = [],
  restore?: { order: NoteOrder; expectedOrder: NoteOrder }): Promise<void> {
  const db = await requireDb();
  const transaction = db.transaction([STORE_NAME, 'noteOrder'], "readwrite");
  try {
    const store = transaction.objectStore(STORE_NAME);
    const orderStore = transaction.objectStore('noteOrder');
    const order = await orderStore.get('groups') ?? {};
    const initialOrder = canonical(order);
    if (restore && initialOrder !== canonical(restore.expectedOrder)) {
      throw new Error('The note order changed. Review the restore again.');
    }
    const previous = new Map(expected.map(note => [note.id, note]));
    for (const note of notes) {
      const before = previous.get(note.id);
      assertSnapshot(await store.get(note.id), before ?? null);
      await store.put(note);
      updateOrderMembership(order, before, note);
    }
    if (restore) mergeNoteOrder(await store.getAll(), order, restore.order);
    if (canonical(order) !== initialOrder) await orderStore.put(order, 'groups');
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
