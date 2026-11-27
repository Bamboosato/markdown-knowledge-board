import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';

it.each([1, 2])('upgrades v%i without losing notes and rejects old-version clients afterwards', async version => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const note = { id: 'before-migration', title: 'Original', body: 'Keep this', tags: [], updatedAt: 1 };
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('markdown-knowledge-board', version);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('notes', { keyPath: 'id' }).add(note);
      if (version === 2) request.result.createObjectStore('mcpReceipts', { keyPath: 'key' }).add({ key: 'existing' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  old.close();
  // idb uses these constructors for its wrapper checks.
  const fake = await import('fake-indexeddb');
  for (const [key, value] of Object.entries(fake)) if (key.startsWith('IDB')) vi.stubGlobal(key, value);
  const { requireDb } = await import('../../src/lib/db');
  const db = await requireDb();
  expect(db.version).toBe(3);
  expect(await db.get('notes', note.id)).toEqual(note);
  expect(db.objectStoreNames.contains('mcpReceipts')).toBe(true);
  expect(await db.get('noteOrder', 'groups')).toBeUndefined();
  if (version === 2) expect(await db.get('mcpReceipts', 'existing')).toEqual({ key: 'existing' });
  await expect(new Promise((resolve, reject) => {
    const request = indexedDB.open('markdown-knowledge-board', version);
    request.onsuccess = () => { request.result.close(); resolve(null); };
    request.onerror = () => reject(request.error);
  })).rejects.toMatchObject({ name: 'VersionError' });
  db.close();
  vi.unstubAllGlobals();
});
