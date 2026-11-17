import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetadataSession, type MetadataPreviewResult } from '../../src/lib/localMcpMetadata';
import { requireDb, saveNote, getNote } from '../../src/lib/db';
import type { Note } from '../../src/lib/types';

const base: Note = { id: 'a', title: 'MCP Guide', body: '# 日本語 📝', tags: ['MCP', 'Guide'], updatedAt: 100,
  pinnedAt: 2, marp: { enabled: true, theme: 'gaia' }, customMetadata: [{ key: 'source', value: 'old' }] };
let session = createMetadataSession();
const change = (action = 'upsert', key = 'source', value: unknown = 'new') => ({ action, key, value });
const preview = (changes = [change()], filter: unknown = { all_notes: true }) =>
  session.execute('preview_custom_metadata_changes', { filter, changes }, () => true) as Promise<MetadataPreviewResult>;
const apply = (plan: MetadataPreviewResult, request_id = 'metadata-001') =>
  session.execute('apply_custom_metadata_changes', { plan_id: plan.plan_id, request_id }, () => true);
beforeEach(async () => {
  session = createMetadataSession();
  const db = await requireDb(); await db.clear('notes'); await db.clear('mcpReceipts');
  await saveNote(base);
});
afterEach(() => vi.restoreAllMocks());

describe('Custom metadata plans', () => {
  it('upserts missing/existing keys, leaves equal values and all other note fields intact', async () => {
    await saveNote({ ...base, id: 'b', customMetadata: [] });
    await saveNote({ ...base, id: 'c', customMetadata: [{ key: 'source', value: 'new' }] });
    const plan = await preview();
    expect(plan).toMatchObject({ status: 'ready', matched_notes: 3, changed_notes: 2, unchanged_notes: 1, skipped_notes: 0 });
    expect(plan.items.map(i => i.changes[0].result)).toEqual(['updated', 'added', 'same_value']);
    expect(await getNote('a')).toEqual(base); // Preview cannot write notes.
    const result = await apply(plan);
    expect(result).toMatchObject({ status: 'applied', updated_notes: 2, unchanged_notes: 1, added_fields: 1, updated_fields: 1, reused: false });
    const saved = (await getNote('a'))!;
    expect(saved).toEqual({ ...base, customMetadata: [{ key: 'source', value: 'new' }], updatedAt: saved.updatedAt });
    expect((await getNote('c'))?.updatedAt).toBe(100);
    expect(await apply(plan)).toEqual({ ...result, reused: true });
    await expect(apply(plan, 'another-request')).rejects.toMatchObject({ code: 'PLAN_ALREADY_APPLIED' });
  });
  it('reports expected add/update skips without failing and permits mixed changed/skipped keys', async () => {
    const none = await preview([change('add'), change('update', 'missing')]);
    expect(none).toMatchObject({ status: 'no_changes', plan_id: null, skipped_notes: 1 });
    expect(none.items[0].changes.map(c => c.result)).toEqual(['key_exists', 'key_missing']);
    const mixed = await preview([change('add'), change('upsert', 'newKey', null), change('update', 'missing')]);
    expect(await apply(mixed)).toMatchObject({ updated_notes: 1, added_fields: 1, updated_fields: 0 });
    expect((await getNote('a'))?.customMetadata).toEqual([{ key: 'source', value: 'old' }, { key: 'newKey', value: null }]);
  });
  it('compares structured values by type and canonical keys, preserving array order and null/empty/false/zero', async () => {
    await saveNote({ ...base, customMetadata: [{ key: 'obj', value: { b: 2, a: 1 } }, { key: 'nil', value: null }] }, base);
    const same = await preview([change('update', 'obj', { a: 1, b: 2 }), change('upsert', 'nil', null)]);
    expect(same).toMatchObject({ status: 'no_changes', unchanged_notes: 1 });
    const plan = await preview([change('upsert', 'nil', ''), change('add', 'flag', false), change('add', 'zero', 0), change('add', 'arr', [2, 1])]);
    await apply(plan);
    expect((await getNote('a'))?.customMetadata?.map(e => e.value)).toEqual([{ b: 2, a: 1 }, '', false, 0, [2, 1]]);
  });
  it('combines filters with AND, exact typed metadata equality, case-sensitive contains, and half-open dates', async () => {
    await saveNote({ ...base, id: 'b', updatedAt: 200, customMetadata: [{ key: 'source', value: null }] });
    const filter = { note_ids: ['a', 'b'], query: 'mcp', scope: 'title', tags: ['MCP', 'Guide'], updated_at: { gte: 100, lt: 200 },
      custom_metadata: [{ key: 'source', op: 'exists' }, { key: 'source', op: 'contains', value: 'ol' }, { key: 'other', op: 'missing' }] };
    expect((await preview([change()], filter)).items.map(i => i.id)).toEqual(['a']);
    expect((await preview([change()], { custom_metadata: [{ key: 'source', op: 'equals', value: null }] })).items.map(i => i.id)).toEqual(['b']);
    expect(await preview([change()], { custom_metadata: [{ key: 'source', op: 'contains', value: 'OLD' }] })).toMatchObject({ status: 'no_matches', plan_id: null });
    expect((await preview([change()], { query: '日本語' })).matched_notes).toBe(2);
    expect((await preview([change()], { query: '日本語', scope: 'title' })).matched_notes).toBe(0);
  });
  it.each([{}, { tags: [] }, { note_ids: [] }, { scope: 'title' }, { query: ' ' }, { all_notes: false }, { all_notes: true, query: 'a' },
    { updated_at: {} }, { updated_at: { gte: 2, lt: 2 } }, { custom_metadata: [{ key: 'source', op: 'exists', value: null }] }, { unknown: true }])('rejects ambiguous filter %j', async filter => {
    await expect(preview([change()], filter)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it.each(['title', 'pinnedAt', '__proto__', 'constructor', ' bad', 'bad ', ''])('rejects managed/unsafe/ambiguous write key %s', async key => {
    await expect(preview([change('upsert', key)])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('rejects duplicate changes, unsafe nested JSON, unknown actions and missing values', async () => {
    for (const changes of [[change(), change()], [change('remove')], [change('upsert', 'nested', JSON.parse('{"constructor":0}'))],
      [{ action: 'upsert', key: 'x' }] as ReturnType<typeof change>[]]) {
      await expect(preview(changes)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });
  it('rejects missing explicit IDs and invalid existing metadata without touching any notes', async () => {
    await expect(preview([change()], { note_ids: ['missing'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const invalid = { ...base, id: 'b', customMetadata: [{ key: 'x', value: 1 }, { key: 'x', value: 2 }] };
    await (await requireDb()).put('notes', invalid);
    await expect(preview()).rejects.toMatchObject({ code: 'INVALID_METADATA' });
    expect(await getNote('a')).toEqual(base);
  });
  it('accepts 50 notes atomically and refuses 51 without truncating', async () => {
    const db = await requireDb();
    for (let i = 1; i < 50; i++) await db.put('notes', { ...base, id: `note-${i}` });
    const plan = await preview(); expect(plan.matched_notes).toBe(50);
    expect(await apply(plan)).toMatchObject({ updated_notes: 50, updated_fields: 50 });
    await db.put('notes', { ...base, id: 'overflow' });
    await expect(preview()).rejects.toMatchObject({ code: 'TOO_MANY_MATCHES' });
  });
  it('enforces value, field, body and response bounds before issuing a plan', async () => {
    await expect(preview([change('upsert', 'long', 'x'.repeat(10001))])).rejects.toMatchObject({ code: 'METADATA_LIMIT_EXCEEDED' });
    const db = await requireDb();
    await db.put('notes', { ...base, customMetadata: Array.from({ length: 100 }, (_, i) => ({ key: `k${i}`, value: 1 })) });
    await expect(preview()).rejects.toMatchObject({ code: 'METADATA_LIMIT_EXCEEDED' });
    await db.put('notes', { ...base, body: 'x'.repeat(131073) });
    await expect(preview()).rejects.toMatchObject({ code: 'NOTE_TOO_LARGE' });
    await db.put('notes', { ...base, body: base.body, title: 'x'.repeat(1000000) });
    await expect(preview()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
  it('fixes the selected IDs and rejects any modified target, even an unchanged/skipped target', async () => {
    await saveNote({ ...base, id: 'b', customMetadata: [{ key: 'source', value: 'new' }] });
    const plan = await preview();
    await saveNote({ ...base, id: 'later' });
    const b = (await getNote('b'))!;
    await saveNote({ ...b, body: 'edited' }, b);
    await expect(apply(plan)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await getNote('a')).toEqual(base);
    const refreshed = await preview([change()], { note_ids: ['a'] });
    await apply(refreshed);
    expect((await getNote('later'))?.customMetadata).toEqual(base.customMetadata);
  });
  it('rejects deleted targets and concurrent stored changes inside the write transaction', async () => {
    const plan = await preview(); await (await requireDb()).delete('notes', 'a');
    await expect(apply(plan)).rejects.toMatchObject({ code: 'CONFLICT' });
    await saveNote(base);
    const original = IDBObjectStore.prototype.get;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'notes' && this.transaction.mode === 'readwrite') this.put({ ...base, body: 'other writer' });
      return original.apply(this, args);
    });
    try { await expect(apply(plan)).rejects.toMatchObject({ code: 'CONFLICT' }); } finally { spy.mockRestore(); }
    expect(await getNote('a')).toEqual(base);
  });
  it('rolls back every note when receipt persistence fails, then allows the exact retry', async () => {
    await saveNote({ ...base, id: 'b' });
    const plan = await preview();
    const original = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'mcpReceipts') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    });
    try { await expect(apply(plan)).rejects.toBeDefined(); } finally { spy.mockRestore(); }
    expect(await getNote('a')).toEqual(base); expect((await getNote('b'))?.customMetadata).toEqual(base.customMetadata);
    expect(await (await requireDb()).count('mcpReceipts')).toBe(0);
    expect(await apply(plan)).toMatchObject({ updated_notes: 2, reused: false });
  });
  it('expires plans, bounds retained plans, invalidates on disconnect and revocation', async () => {
    const plan = await preview();
    vi.spyOn(Date, 'now').mockReturnValue(plan.expires_at!);
    await expect(apply(plan)).rejects.toMatchObject({ code: 'PLAN_EXPIRED' });
    vi.restoreAllMocks(); session.clear();
    await expect(apply(plan)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    for (let i = 0; i < 5; i++) await preview();
    await expect(preview()).rejects.toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });
    session.close();
    await expect(preview()).rejects.toMatchObject({ code: 'ACCESS_DISABLED' });
  });
  it('replays the durable receipt after reconnect/expiry/later edits/deletion and detects request ID reuse', async () => {
    const plan = await preview(); const another = await preview();
    const first = await apply(plan);
    await expect(apply(another)).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
    session = createMetadataSession();
    await (await requireDb()).delete('notes', 'a');
    vi.spyOn(Date, 'now').mockReturnValue(plan.expires_at! + 1);
    expect(await apply(plan)).toEqual({ ...first, reused: true });
    await expect(session.execute('apply_custom_metadata_changes', { plan_id: plan.plan_id, request_id: 'metadata-001' }, () => false)).rejects.toMatchObject({ code: 'ACCESS_DISABLED' });
  });
  it('protects stored plans from mutations to returned previews', async () => {
    const plan = await preview([change('upsert', 'obj', { x: 1 })]);
    plan.items[0].changes[0].after = { exists: true, value: 'tampered' };
    plan.items[0].expected_revision = 'tampered';
    await apply(plan);
    expect((await getNote('a'))?.customMetadata?.at(-1)).toEqual({ key: 'obj', value: { x: 1 } });
  });
  it('serializes concurrent exact replays and rejects a competing plan without losing data', async () => {
    const plan = await preview(); const competing = await preview([change('upsert', 'source', 'other')]);
    const results = await Promise.all([apply(plan), apply(plan)]);
    expect(results.map(r => 'reused' in r && r.reused).sort()).toEqual([false, true]);
    await expect(apply(competing, 'competing-001')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await getNote('a'))?.customMetadata?.[0].value).toBe('new');
  });
  it('aborts when permission is withdrawn during persistence', async () => {
    const plan = await preview(); let allowed = true;
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'notes') allowed = false;
      return original.apply(this, args);
    });
    try {
      await expect(session.execute('apply_custom_metadata_changes', { plan_id: plan.plan_id, request_id: 'revoke-001' }, () => allowed)).rejects.toMatchObject({ code: 'ACCESS_DISABLED' });
    } finally { spy.mockRestore(); }
    expect(await getNote('a')).toEqual(base);
  });
});
