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

describe('MCP literal text edits', () => {
  const edit = async (extra = {}, request_id = 'text-edit-001') => ({ note_id: base.id, expected_revision: await noteRevision((await getNote(base.id))!), request_id, ...extra });
  it('appends literally with no separator, preserving metadata, including whitespace and empty original bodies', async () => {
    const input = await edit({ text: '\n$& 📝\n' });
    const first = await call('append_note', input);
    expect(first).toMatchObject({ status: 'updated', reused: false });
    const saved = (await getNote(base.id))!;
    expect(saved).toEqual({ ...base, body: base.body + input.text, updatedAt: saved.updatedAt });
    expect(await call('append_note', input)).toEqual({ ...(first as object), reused: true });
    await call('append_note', await edit({ text: '\n' }, 'whitespace-001'));
    const current = (await getNote(base.id))!;
    await saveNote({ ...current, body: '' }, current);
    await call('append_note', await edit({ text: 'first' }, 'empty-body-001'));
    expect((await getNote(base.id))?.body).toBe('first');
  });
  it('defaults to one exact match and inserts replacement syntax literally; omitted/explicit single replay identically', async () => {
    const input = await edit({ search_text: '日本語', replacement_text: '$&$1\\n' });
    expect(await call('replace_note_text', input)).toMatchObject({ replacement_count: 1, status: 'updated' });
    expect((await getNote(base.id))?.body).toBe('# Guide\n$&$1\\n 📝');
    expect(await call('replace_note_text', { ...input, mode: 'single' })).toMatchObject({ reused: true, replacement_count: 1 });
    await expect(call('replace_note_text', { ...input, mode: 'all' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
  });
  it.each([
    ['aaa', 'aa', 'single', null, 'MULTIPLE_MATCHES', 0],
    ['aaa', 'aa', 'all', 'Xa', null, 1],
    ['aaaa', 'aa', 'all', 'XX', null, 2],
    ['aa', 'a', 'all', 'XX', null, 2],
    ['a A', 'a', 'single', 'X A', null, 1],
    ['line\r\n', 'line\n', 'all', null, 'TEXT_NOT_FOUND', 0],
    ['café', 'cafe\u0301', 'single', null, 'TEXT_NOT_FOUND', 0],
  ])('matches %s / %s in %s mode', async (body, search, mode, expected, error, count) => {
    await saveNote({ ...base, body }, base);
    const input = await edit({ search_text: search, replacement_text: 'X', mode });
    if (error) {
      await expect(call('replace_note_text', input)).rejects.toMatchObject({ code: error });
      expect((await getNote(base.id))?.body).toBe(body);
      expect(await (await requireDb()).count('mcpReceipts')).toBe(0);
    } else {
      expect(await call('replace_note_text', input)).toMatchObject({ replacement_count: count });
      expect((await getNote(base.id))?.body).toBe(expected);
    }
  });
  it('does not match inserted text, allows deletion, and records unchanged matches without changing revision/date', async () => {
    await saveNote({ ...base, body: 'a a' }, base);
    const unchanged = await edit({ search_text: 'a', replacement_text: 'a', mode: 'all' });
    expect(await call('replace_note_text', unchanged)).toMatchObject({ status: 'unchanged', replacement_count: 2, revision: unchanged.expected_revision, updated_at: 1 });
    await call('replace_note_text', await edit({ search_text: 'a', replacement_text: 'aa', mode: 'all' }, 'expand-once-001'));
    expect((await getNote(base.id))?.body).toBe('aa aa');
    await call('replace_note_text', await edit({ search_text: 'aa', replacement_text: '', mode: 'all' }, 'delete-text-001'));
    expect((await getNote(base.id))?.body).toBe(' ');
    expect(await call('replace_note_text', unchanged)).toMatchObject({ reused: true, replacement_count: 2 });
  });
  it.each(['append_note', 'replace_note_text'])('%s preserves conflict, authorization, atomic rollback and durable replay rules', async op => {
    const input = await edit(op === 'append_note' ? { text: ' More' } : { search_text: 'Guide', replacement_text: 'Manual' });
    await expect(call(op, input, false)).rejects.toMatchObject({ code: 'ACCESS_DISABLED' });
    const original = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'mcpReceipts') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    });
    try { await expect(call(op, input)).rejects.toBeDefined(); } finally { spy.mockRestore(); }
    expect(await getNote(base.id)).toEqual(base);
    const first = await call(op, input);
    await expect(call(op, { ...input, request_id: 'stale-edit-001' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const saved = (await getNote(base.id))!;
    await saveNote({ ...saved, body: 'Later manual edit' }, saved);
    expect(await call(op, input)).toEqual({ ...(first as object), reused: true });
    expect((await getNote(base.id))?.body).toBe('Later manual edit');
    await deleteNote(base.id, (await getNote(base.id))!);
    expect(await call(op, input)).toEqual({ ...(first as object), reused: true });
    expect(await getNote(base.id)).toBeUndefined();
  });
  it('rejects invalid inputs and oversize results without creating receipts; accepts the exact byte boundary', async () => {
    for (const extra of [{ text: '' }, { text: 'a', expected_matches: 1 }, { text: 'あ'.repeat(43691) }]) {
      await expect(call('append_note', await edit(extra))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    for (const extra of [{ search_text: '', replacement_text: '' }, { search_text: 'a', replacement_text: '', mode: null }, { search_text: 'a', replacement_text: '', expected_count: 2 }]) {
      await expect(call('replace_note_text', await edit(extra))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await saveNote({ ...base, body: 'a'.repeat(131071) }, base);
    await expect(call('append_note', await edit({ text: 'あ' }))).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
    await expect(call('replace_note_text', await edit({ search_text: 'a', replacement_text: 'あ', mode: 'all' }))).rejects.toMatchObject({ code: 'RESULT_TOO_LARGE' });
    expect(await (await requireDb()).count('mcpReceipts')).toBe(0);
    await call('append_note', await edit({ text: 'b' }));
    expect((await getNote(base.id))?.body.length).toBe(131072);
    const saved = (await getNote(base.id))!;
    await saveNote({ ...saved, body: saved.body + 'c' }, saved);
    await expect(call('replace_note_text', await edit({ search_text: 'a', replacement_text: '', mode: 'all' }, 'large-existing-001'))).rejects.toMatchObject({ code: 'NOTE_TOO_LARGE' });
  });
  it('serializes racing appends and deduplicates concurrent identical requests', async () => {
    const input = await edit({ text: 'X' });
    const results = await Promise.allSettled([call('append_note', input), call('append_note', { ...input, request_id: 'racing-edit-002' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const retry = await edit({ text: 'Y' }, 'racing-edit-003');
    const duplicate = await Promise.all([call('append_note', retry), call('append_note', retry)]);
    expect(duplicate).toEqual(expect.arrayContaining([expect.objectContaining({ reused: true }), expect.objectContaining({ reused: false })]));
    expect((await getNote(base.id))?.body).toBe(base.body + 'XY');
  });
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
