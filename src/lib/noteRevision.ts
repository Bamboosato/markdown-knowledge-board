import type { Note } from './types';

// Stable keys, including nested metadata. Missing optional properties match undefined.
export function canonical(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => [key, normalize(value)]));
    return item;
  };
  return JSON.stringify(normalize(value ?? null));
}

export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
export async function noteRevision(note: Note): Promise<string> { return `v1-${await digest(note)}`; }

export class NoteAccessError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export function assertSnapshot(current: Note | undefined, expected: Note | null) {
  if (canonical(current) !== canonical(expected)) throw new NoteAccessError('CONFLICT',
    'This note changed elsewhere. Your edits are kept. Reopen the latest note before saving.');
}
