import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';

it('upgrades v1 without losing notes and rejects old-version clients afterwards', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const note = { id: 'before-migration', title: 'Original', body: 'Keep this', tags: [], updatedAt: 1 };
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('markdown-knowledge-board', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('notes', { keyPath: 'id' }).add(note);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  old.close();
  // idb uses these constructors for its wrapper checks.
  const fake = await import('fake-indexeddb');
  for (const [key, value] of Object.entries(fake)) if (key.startsWith('IDB')) vi.stubGlobal(key, value);
  const { requireDb } = await import('../../src/lib/db');
  const db = await requireDb();
  expect(db.version).toBe(2);
  expect(await db.get('notes', note.id)).toEqual(note);
  expect(db.objectStoreNames.contains('mcpReceipts')).toBe(true);
  await expect(new Promise((resolve, reject) => {
    const request = indexedDB.open('markdown-knowledge-board', 1);
    request.onsuccess = () => { request.result.close(); resolve(null); };
    request.onerror = () => reject(request.error);
  })).rejects.toMatchObject({ name: 'VersionError' });
  db.close();
  vi.unstubAllGlobals();
});
