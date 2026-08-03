import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  applyNotesTransaction,
  getAllNotes,
  saveNote,
} from "../../src/lib/db";
import type { Note } from "../../src/lib/types";

const DB_NAME = "markdown-knowledge-board";
const STORE_NAME = "notes";

function createNote(id: string, body = `Body ${id}`): Note {
  return {
    id,
    title: `Note ${id}`,
    body,
    tags: [],
    updatedAt: 100,
  };
}

async function clearNotesStore(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

beforeEach(async () => {
  await clearNotesStore();
});

describe("applyNotesTransaction", () => {
  it("commits all added and updated notes in one transaction", async () => {
    await saveNote(createNote("updated", "before"));

    await applyNotesTransaction([
      createNote("added"),
      createNote("updated", "after"),
    ]);

    const notes = (await getAllNotes()).sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    expect(notes).toEqual([
      createNote("added"),
      createNote("updated", "after"),
    ]);
  });

  it("keeps existing data when the apply list is empty", async () => {
    await saveNote(createNote("existing"));

    await applyNotesTransaction([]);

    expect(await getAllNotes()).toEqual([createNote("existing")]);
  });

  it("rolls back earlier writes when a later note cannot be cloned", async () => {
    await saveNote(createNote("existing"));
    const invalidNote = {
      ...createNote("invalid"),
      body: () => "not cloneable",
    } as unknown as Note;

    await expect(
      applyNotesTransaction([createNote("would-be-added"), invalidNote])
    ).rejects.toBeDefined();

    expect(await getAllNotes()).toEqual([createNote("existing")]);
  });
});
