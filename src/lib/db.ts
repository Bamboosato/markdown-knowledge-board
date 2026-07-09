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
  const db = await getDb();
  if (!db) {
    throw createDbUnavailableError();
  }
  await db.put(STORE_NAME, note);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw createDbUnavailableError();
  }
  await db.delete(STORE_NAME, id);
}
