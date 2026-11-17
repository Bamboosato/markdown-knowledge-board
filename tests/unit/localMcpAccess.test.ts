import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeNoteAccess } from '../../src/lib/localMcpAccess';
import { requireDb, saveNote, getNote, applyNotesTransaction, deleteNote } from '../../src/lib/db';
import { noteRevision } from '../../src/lib/noteRevision';
import type { Note } from '../../src/lib/types';

const base: Note = { id: 'ordinary-id', title: 'MCP 日本語', body: '# Guide\n日本語 📝', tags: ['MCP'], updatedAt: 1,
  pinnedAt: 2, marp: { enabled: true, theme: 'gaia', size: '4:3', paginate: false, headingDivider: 2 },
  customMetadata: [{ key: 'source', value: { a: 1 } }] };
const call = (op: string, input: unknown, allowed = true) => executeNoteAccess(op, input, () => allowed);
const update = async (request_id = 'update-0001', extra = {}) => ({ note_id: base.id, expected_revision: await noteRevision(base), request_id, body: 'New body', ...extra });
beforeEach(async () => {
  const db = await requireDb();
  await db.clear('notes'); await db.clear('mcpReceipts');
  await saveNote(base);
});

describe('MCP saved note access', () => {
  it('requires access and distinguishes missing IDs; reads complete saved metadata', async () => {
    await expect(call('get_note', { note_id: base.id }, false)).rejects.toMatchObject({ code: 'ACCESS_DISABLED' });
    await expect(call('get_note', { note_id: 'absent' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await call('get_note', { note_id: base.id })).toMatchObject({ body: base.body, marp: base.marp, revision: await noteRevision(base) });
  });
  it('searches literal text and exact AND tags, with deterministic pages', async () => {
    await saveNote({ ...base, id: 'another', title: 'Another', tags: ['MCP', 'x'] });
    expect(await call('search_notes', { query: 'mcp', scope: 'title' })).toMatchObject({ total: 1 });
    expect(await call('search_notes', { query: '日本語', tags: ['MCP', 'x'] })).toMatchObject({ total: 1 });
    expect(await call('search_notes', { tags: ['mcp'] })).toMatchObject({ total: 0 });
    expect(await call('search_notes', { limit: 1 })).toMatchObject({ items: [{ id: 'another' }], total: 2, next_offset: 1 });
  });
  it('replaces raw body, preserving all metadata; empty body and tags are explicit', async () => {
    const input = await update('update-0001', { body: '---\nid: injected\n---\nRaw' });
    expect(await call('update_note', input)).toMatchObject({ status: 'updated', reused: false });
    const changed = (await getNote(base.id))!;
    expect(changed).toEqual({ ...base, body: input.body, updatedAt: changed.updatedAt });
    await call('update_note', { ...input, request_id: 'update-0002', expected_revision: await noteRevision(changed), body: '', tags: [] });
    expect(await getNote(base.id)).toMatchObject({ body: '', tags: [], marp: base.marp });
  });
  it('does not change timestamps for an unchanged update', async () => {
    expect(await call('update_note', await update('unchanged-001', { body: base.body }))).toMatchObject({ status: 'unchanged', updated_at: 1 });
  });
  it('replays durable receipts without reverting later edits or resurrecting deletions', async () => {
    const input = await update();
    await call('update_note', input);
    const saved = (await getNote(base.id))!;
    const later = { ...saved, body: 'User change' };
    await saveNote(later, saved);
    expect(await call('update_note', input)).toMatchObject({ reused: true });
    expect((await getNote(base.id))?.body).toBe('User change');
    await deleteNote(base.id, later);
    expect(await call('update_note', input)).toMatchObject({ reused: true });
    expect(await getNote(base.id)).toBeUndefined();
    await expect(call('update_note', { ...input, title: 'Different' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
  });
  it('rejects same-millisecond metadata changes and stale UI writes', async () => {
    const input = await update();
    const changed = { ...base, pinnedAt: 3 };
    await saveNote(changed, base);
    await expect(call('update_note', input)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(saveNote({ ...base, body: 'Stale UI' }, base)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(applyNotesTransaction([{ ...base, id: 'new' }, base], [base])).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await getNote('new')).toBeUndefined();
  });
  it('serializes racing updates and duplicate retries', async () => {
    const input = await update();
    const outcomes = await Promise.allSettled([call('update_note', input), call('update_note', { ...input, request_id: 'update-other', body: 'Other' })]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await getNote(base.id))!;
    const retry = { ...input, request_id: 'retry-0001', expected_revision: await noteRevision(current), body: 'Retry' };
    const results = await Promise.all([call('update_note', retry), call('update_note', retry)]);
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ reused: true }), expect.objectContaining({ reused: false })]));
  });
  it('rejects oversized Unicode, unknown fields, and reports large existing notes without truncation', async () => {
    await expect(call('update_note', await update('large-0001', { body: 'あ'.repeat(43691) }))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(call('update_note', await update('unknown-001', { pinnedAt: 0 }))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await saveNote({ ...base, body: 'a'.repeat(131073) }, base);
    await expect(call('get_note', { note_id: base.id })).rejects.toMatchObject({ code: 'NOTE_TOO_LARGE' });
    expect(await call('search_notes', {})).toMatchObject({ items: [{ body_bytes: 131073 }] });
  });
  it('rolls back the note when the durable receipt cannot be saved', async () => {
    const original = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'mcpReceipts') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    });
    try { await expect(call('update_note', await update())).rejects.toBeDefined(); }
    finally { spy.mockRestore(); }
    expect(await getNote(base.id)).toEqual(base);
    expect(await (await requireDb()).count('mcpReceipts')).toBe(0);
  });
});
