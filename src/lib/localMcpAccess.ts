import { requireDb, type UpdateReceipt, type McpReceipt } from './db';
import { assertSnapshot, canonical, digest, noteRevision, NoteAccessError } from './noteRevision';
import { acquireNoteUpdate, notifyNotesChanged } from './noteEvents';
import type { Note } from './types';

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const invalid = () => { throw new NoteAccessError('INVALID_ARGUMENT', 'Invalid note request.'); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function tags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some(v => typeof v !== 'string' || !v.trim() || v.trim().length > 80)) return invalid();
  return value.map(v => (v as string).trim());
}
function keys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid();
}
function id(input: Record<string, unknown>): string {
  if (typeof input.note_id !== 'string' || !input.note_id.length || input.note_id.length > 65536) return invalid();
  return input.note_id;
}
function size(note: Note) {
  if (bytes(note.body) > 131072) throw new NoteAccessError('NOTE_TOO_LARGE', `Body is ${bytes(note.body)} bytes; limit is 131072 bytes.`);
}
function text(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.length) || value.length > 131072 || bytes(value) > 131072) return invalid();
  return value;
}
function replaceText(body: string, search: string, replacement: string, mode: string) {
  // Single mode counts overlapping occurrences; all mode consumes each original match.
  const pieces: string[] = [];
  let cursor = 0;
  let count = 0;
  let position = body.indexOf(search);
  while (position !== -1) {
    count++;
    if (mode === 'single' && count > 1) throw new NoteAccessError('MULTIPLE_MATCHES', 'More than one match. Narrow the search or explicitly choose all mode.');
    pieces.push(body.slice(cursor, position), replacement);
    cursor = position + search.length;
    position = body.indexOf(search, mode === 'single' ? position + 1 : cursor);
  }
  if (!count) throw new NoteAccessError('TEXT_NOT_FOUND', 'Search text not found.');
  pieces.push(body.slice(cursor));
  // Bound allocation before joining a potentially very large expansion.
  if (body.length + count * (replacement.length - search.length) > 131072) {
    throw new NoteAccessError('RESULT_TOO_LARGE', 'Resulting body exceeds 128 KiB.');
  }
  const result = pieces.join('');
  if (bytes(result) > 131072) throw new NoteAccessError('RESULT_TOO_LARGE', 'Resulting body exceeds 128 KiB.');
  return { body: result, count };
}
export async function executeNoteAccess(operation: string, raw: unknown, allowed: () => boolean) {
  const authorize = () => { if (!allowed()) throw new NoteAccessError('ACCESS_DISABLED', 'Enable reading and updating notes in MKB Advanced settings.'); };
  authorize();
  const input = object(raw);
  const db = await requireDb();
  let result: unknown;
  if (operation === 'search_notes') {
    keys(input, ['query', 'scope', 'tags', 'limit', 'offset']);
    const { query = '', scope = 'title_body', limit = 20, offset = 0 } = input;
    if (typeof query !== 'string' || query.length > 200 || !['title', 'title_body'].includes(scope as string) ||
        !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50 || !Number.isSafeInteger(offset) || Number(offset) < 0) invalid();
    const filters = input.tags === undefined ? [] : tags(input.tags);
    const needle = (query as string).trim().toLowerCase();
    const notes = (await db.getAll('notes')).filter(note => filters.every(tag => note.tags.includes(tag)) &&
      (note.title.toLowerCase().includes(needle) || scope === 'title_body' && note.body.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const end = Number(offset) + Number(limit);
    result = { items: notes.slice(Number(offset), end).map(note => {
      const start = Math.max(0, note.body.toLowerCase().indexOf(needle) - 40);
      return { id: note.id, title: note.title, tags: note.tags, updated_at: note.updatedAt,
        snippet: Array.from(note.body.slice(start)).slice(0, 160).join(''), body_bytes: bytes(note.body) };
    }), total: notes.length, next_offset: end < notes.length ? end : null };
  } else if (operation === 'get_note') {
    keys(input, ['note_id']);
    const note = await db.get('notes', id(input));
    if (!note) throw new NoteAccessError('NOT_FOUND', 'Note not found.');
    size(note);
    result = { id: note.id, title: note.title, body: note.body, tags: note.tags, updated_at: note.updatedAt,
      pinned_at: note.pinnedAt, marp: note.marp, custom_metadata: note.customMetadata,
      revision: await noteRevision(note), body_bytes: bytes(note.body) };
  } else if (['update_note', 'append_note', 'replace_note_text'].includes(operation)) {
    const fields = operation === 'update_note' ? ['body', 'title', 'tags'] : operation === 'append_note' ? ['text'] : ['search_text', 'replacement_text', 'mode'];
    keys(input, ['note_id', 'expected_revision', 'request_id', ...fields]);
    const noteId = id(input);
    if (typeof input.expected_revision !== 'string' || !/^v1-[a-f0-9]{64}$/.test(input.expected_revision) ||
        typeof input.request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.request_id) ||
        (operation === 'update_note' && !['body', 'title', 'tags'].some(key => key in input))) invalid();
    const changes: Partial<Note> = {};
    if ('body' in input) {
      changes.body = text(input.body);
    }
    if ('title' in input) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) invalid();
      changes.title = (input.title as string).trim();
    }
    if ('tags' in input) changes.tags = tags(input.tags);
    if (operation === 'append_note') text(input.text, true);
    const mode = input.mode === undefined ? 'single' : input.mode;
    if (operation === 'replace_note_text') {
      text(input.search_text, true); text(input.replacement_text);
      if (mode !== 'single' && mode !== 'all') invalid();
    }
    const prefix = operation === 'update_note' ? 'update' : operation === 'append_note' ? 'append' : 'replace';
    const key = `${prefix}:${input.request_id}`;
    const fingerprint = await digest(operation === 'update_note' ? { ...input, ...changes } : {
      operation, input: operation === 'replace_note_text' ? { ...input, mode } : input,
    });
    const reuse = (receipt: McpReceipt) => {
      if (receipt.result.status === 'applied') throw new NoteAccessError('REQUEST_ID_CONFLICT', 'Invalid receipt for this operation.');
      if (receipt.digest !== fingerprint) throw new NoteAccessError('REQUEST_ID_CONFLICT', 'Request ID already used for different input.');
      return { ...receipt.result, reused: true };
    };
    const prior = await db.get('mcpReceipts', key);
    if (prior) { authorize(); return reuse(prior); }
    const snapshot = await db.get('notes', noteId);
    if (!snapshot) throw new NoteAccessError('NOT_FOUND', 'Note not found.');
    size(snapshot);
    const revision = await noteRevision(snapshot);
    if (revision !== input.expected_revision) throw new NoteAccessError('CONFLICT', 'Note changed. Get the latest note before updating.');
    let replacementCount: number | undefined;
    if (operation === 'append_note') {
      changes.body = snapshot.body + input.text;
      if (bytes(changes.body) > 131072) throw new NoteAccessError('RESULT_TOO_LARGE', 'Resulting body exceeds 128 KiB.');
    } else if (operation === 'replace_note_text') {
      const replaced = replaceText(snapshot.body, input.search_text as string, input.replacement_text as string, mode as string);
      changes.body = replaced.body;
      replacementCount = replaced.count;
    }
    const next = { ...snapshot, ...changes };
    const unchanged = canonical(next) === canonical(snapshot);
    if (!unchanged) next.updatedAt = Date.now();
    const receipt: UpdateReceipt = { key, digest: fingerprint, result: {
      status: unchanged ? 'unchanged' : 'updated', id: next.id, title: next.title, previous_revision: revision,
      revision: unchanged ? revision : await noteRevision(next), updated_at: next.updatedAt, reused: false,
      ...(replacementCount === undefined ? {} : { replacement_count: replacementCount }),
    } };
    authorize();
    let release: () => void;
    try { release = acquireNoteUpdate(noteId); } catch { throw new NoteAccessError('NOTE_BUSY', 'Finish editing or saving this note, then get it again.'); }
    const tx = db.transaction(['notes', 'mcpReceipts'], 'readwrite');
    try {
      const existing = await tx.objectStore('mcpReceipts').get(key);
      if (existing) { result = reuse(existing); }
      else {
        const current = await tx.objectStore('notes').get(noteId);
        authorize();
        assertSnapshot(current, snapshot);
        if (!unchanged) await tx.objectStore('notes').put(next);
        await tx.objectStore('mcpReceipts').add(receipt);
        result = receipt.result;
      }
      await tx.done;
      notifyNotesChanged();
    } catch (error) {
      try { tx.abort(); } catch { /* finished */ }
      await tx.done.catch(() => {});
      throw error;
    } finally { release(); }
    return result; // Commit already succeeded; permission revocation cannot undo it.
  } else throw new NoteAccessError('UNSUPPORTED_OPERATION', 'Update MKB and the local MCP runtime.');
  authorize();
  if (bytes(JSON.stringify(result)) > 1000000) throw new NoteAccessError('RESPONSE_TOO_LARGE', 'Response exceeds the 1 MiB limit.');
  return result;
}
