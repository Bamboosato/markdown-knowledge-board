import { requireDb, type McpReceipt, type MetadataReceipt } from './db';
import { assertSnapshot, canonical, digest, noteRevision, NoteAccessError } from './noteRevision';
import { acquireNoteUpdate, notifyNotesChanged } from './noteEvents';
import { assertFrontmatterExpansion, normalizeFrontmatterValue, serializeFrontmatterValue, RESERVED_FRONTMATTER_KEYS, UNSAFE_FRONTMATTER_KEYS } from './frontmatter';
import type { CustomMetadataEntry, FrontmatterValue, Note } from './types';

type ValueAction = 'add' | 'update' | 'upsert';
type Change = { action: ValueAction; key: string; value: FrontmatterValue } | { action: 'remove'; key: string };
type Condition = { key: string; op: 'exists' | 'missing' | 'equals' | 'contains'; value?: FrontmatterValue };
type Filter = { note_ids?: string[]; query?: string; scope?: 'title' | 'title_body'; tags?: string[];
  updated_at?: { gte?: number; lt?: number }; custom_metadata?: Condition[]; all_notes?: true };
type Presence = { exists: false } | { exists: true; value: FrontmatterValue };
type Diff = Pick<Change, 'action' | 'key'> & { result: 'added' | 'updated' | 'removed' | 'same_value' | 'key_exists' | 'key_missing'; before: Presence; after: Presence };
type Item = { id: string; title: string; expected_revision: string; status: 'changed' | 'unchanged' | 'skipped'; changes: Diff[] };
type Counts = { matched_notes: number; unchanged_notes: number; skipped_notes: number };
export type MetadataPreviewResult = Counts & { status: 'ready' | 'no_matches' | 'no_changes'; plan_id: string | null;
  expires_at?: number; changed_notes: number; items: Item[] };
export type MetadataApplyResult = Counts & { status: 'applied'; plan_id: string; updated_notes: number;
  added_fields: number; updated_fields: number; removed_fields?: number; reused: boolean;
  items: { id: string; status: 'updated' | 'unchanged' | 'skipped'; previous_revision: string; revision: string; updated_at: number }[] };
type Plan = { expiresAt: number; items: Item[]; metadata: Map<string, CustomMetadataEntry[]>; bytes: number; applied: boolean };

const MAX_RESPONSE = 1000000;
const MAX_PLAN_BYTES = 8 * 1024 * 1024;
const MAX_SESSION_BYTES = 16 * 1024 * 1024;
const PLAN_TTL = 10 * 60 * 1000;
const bytes = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length;
function fail(code: string, message: string): never { throw new NoteAccessError(code, message); }
function invalid(): never { return fail('INVALID_ARGUMENT', 'Invalid Custom metadata request.'); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) invalid(); }
function string(v: unknown, max: number, trim = false): string {
  if (typeof v !== 'string' || v.length > max || !(trim ? v.trim() : v).length) return invalid();
  return trim ? v.trim() : v;
}
function list(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || !v.length || v.length > max) return invalid(); return v; }
function inputValue(v: unknown): FrontmatterValue {
  try { assertFrontmatterExpansion(v); return normalizeFrontmatterValue(v); } catch { return invalid(); }
}
function writeKey(v: unknown): string {
  const key = string(v, 100);
  if (key !== key.trim() || RESERVED_FRONTMATTER_KEYS.has(key) || UNSAFE_FRONTMATTER_KEYS.has(key) || key === 'pinnedAt') invalid();
  return key;
}
function parsePreview(raw: unknown): { filter: Filter; changes: Change[] } {
  const input = object(raw); keys(input, ['filter', 'changes']);
  const f = object(input.filter); keys(f, ['note_ids', 'query', 'scope', 'tags', 'updated_at', 'custom_metadata', 'all_notes']);
  const filter: Filter = {};
  if ('all_notes' in f) { if (f.all_notes !== true || Object.keys(f).length !== 1) invalid(); filter.all_notes = true; }
  if ('note_ids' in f) filter.note_ids = list(f.note_ids, 50).map(v => string(v, 65536));
  if ('query' in f) filter.query = string(f.query, 200, true);
  if ('scope' in f) {
    if (!filter.query || (f.scope !== 'title' && f.scope !== 'title_body')) invalid();
    filter.scope = f.scope as Filter['scope'];
  }
  if ('tags' in f) filter.tags = list(f.tags, 32).map(v => string(v, 80, true));
  if ('updated_at' in f) {
    const range = object(f.updated_at); keys(range, ['gte', 'lt']);
    if (!Object.keys(range).length || Object.values(range).some(v => !Number.isSafeInteger(v))) invalid();
    if (range.gte !== undefined && range.lt !== undefined && Number(range.gte) >= Number(range.lt)) invalid();
    filter.updated_at = range as Filter['updated_at'];
  }
  if ('custom_metadata' in f) filter.custom_metadata = list(f.custom_metadata, 20).map(raw => {
    const c = object(raw); keys(c, ['key', 'op', 'value']);
    const key = string(c.key, 100);
    if (!['exists', 'missing', 'equals', 'contains'].includes(c.op as string)) invalid();
    const op = c.op as Condition['op'];
    if (op === 'exists' || op === 'missing') { if ('value' in c) invalid(); return { key, op }; }
    const value = op === 'contains' ? string(c.value, 10000) : inputValue(c.value);
    return { key, op, value };
  });
  if (!Object.keys(filter).length) invalid();
  const changes: Change[] = list(input.changes, 20).map(raw => {
    const c = object(raw); keys(c, ['action', 'key', 'value']);
    if (c.action === 'remove') {
      if ('value' in c) invalid();
      return { action: 'remove', key: writeKey(c.key) };
    }
    if (!['add', 'update', 'upsert'].includes(c.action as string)) invalid();
    return { action: c.action as ValueAction, key: writeKey(c.key), value: inputValue(c.value) };
  });
  if (new Set(changes.map(c => c.key)).size !== changes.length) invalid();
  // Clone so callers cannot mutate an in-flight request or a stored plan.
  return structuredClone({ filter, changes });
}
function metadata(note: Note): CustomMetadataEntry[] {
  const entries = note.customMetadata ?? [];
  if (!Array.isArray(entries)) return fail('INVALID_METADATA', 'Saved Custom metadata is invalid.');
  const seen = new Set<string>();
  try {
    assertFrontmatterExpansion(entries);
    for (const entry of entries) {
      const key = writeKey(entry.key);
      if (seen.has(key)) throw new Error('Duplicate key');
      seen.add(key); normalizeFrontmatterValue(entry.value);
    }
  } catch { return fail('INVALID_METADATA', 'Saved Custom metadata contains invalid or duplicate fields.'); }
  return entries;
}
function validateResult(entries: CustomMetadataEntry[]) {
  try {
    if (entries.length > 100) throw new Error('Too many fields');
    assertFrontmatterExpansion(entries);
    for (const entry of entries) if (serializeFrontmatterValue(entry.value).length > 10000) throw new Error('Value too long');
  } catch { fail('METADATA_LIMIT_EXCEEDED', 'Resulting Custom metadata exceeds the field, value or expansion limit.'); }
}
function basicMatch(note: Note, f: Filter) {
  const q = f.query?.toLowerCase();
  return (!f.note_ids || f.note_ids.includes(note.id)) && (!q || note.title.toLowerCase().includes(q) ||
    (f.scope ?? 'title_body') === 'title_body' && note.body.toLowerCase().includes(q)) &&
    (!f.tags || f.tags.every(tag => note.tags.includes(tag))) &&
    (f.updated_at?.gte === undefined || note.updatedAt >= f.updated_at.gte) &&
    (f.updated_at?.lt === undefined || note.updatedAt < f.updated_at.lt);
}
function metadataMatch(entries: CustomMetadataEntry[], conditions: Condition[] = []) {
  return conditions.every(c => {
    const e = entries.find(e => e.key === c.key);
    if (c.op === 'exists') return e !== undefined;
    if (c.op === 'missing') return e === undefined;
    if (!e) return false;
    if (c.op === 'contains') return typeof e.value === 'string' && e.value.includes(c.value as string);
    return canonical(e.value) === canonical(c.value);
  });
}
function propose(entries: CustomMetadataEntry[], changes: Change[]) {
  const next = structuredClone(entries);
  const diffs: Diff[] = changes.map(c => {
    const index = next.findIndex(e => e.key === c.key);
    const before: Presence = index < 0 ? { exists: false } : { exists: true, value: next[index].value };
    if (c.action === 'remove') {
      if (index >= 0) next.splice(index, 1);
      return { action: c.action, key: c.key, result: index < 0 ? 'key_missing' : 'removed', before, after: { exists: false } };
    }
    let result: Diff['result'];
    if (index >= 0 && c.action === 'add') result = 'key_exists';
    else if (index < 0 && c.action === 'update') result = 'key_missing';
    else if (index >= 0 && canonical(next[index].value) === canonical(c.value)) result = 'same_value';
    else if (index < 0) { next.push({ key: c.key, value: c.value }); result = 'added'; }
    else { next[index].value = c.value; result = 'updated'; }
    const changed = result === 'added' || result === 'updated';
    return { action: c.action, key: c.key, result, before, after: changed ? { exists: true, value: c.value } : before };
  });
  validateResult(next);
  const status: Item['status'] = diffs.some(d => ['added', 'updated', 'removed'].includes(d.result)) ? 'changed'
    : diffs.some(d => d.result === 'same_value') ? 'unchanged' : 'skipped';
  return { next, diffs, status };
}
function bounded<T>(result: T): T {
  if (bytes(result) > MAX_RESPONSE) fail('RESPONSE_TOO_LARGE', 'Metadata response exceeds 1,000,000 bytes. Narrow the selection.');
  return result;
}

/** One instance per connected PWA session. Plans never cross a reconnect or a permission revocation. */
export function createMetadataSession() {
  const plans = new Map<string, Plan>();
  let generation = 0;
  let closed = false;
  const clear = () => { generation++; plans.clear(); };
  return {
    clear,
    close() { closed = true; clear(); },
    async execute(operation: string, raw: unknown, allowed: () => boolean, supportsRemove: () => boolean = () => false): Promise<MetadataPreviewResult | MetadataApplyResult> {
      const epoch = generation;
      const authorize = () => {
        if (closed || generation !== epoch || !allowed()) fail('ACCESS_DISABLED', 'Enable reading and updating notes and preview again.');
      };
      authorize();
      const requireRemove = () => {
        if (!supportsRemove()) fail('UPGRADE_REQUIRED', 'Update the local MCP service to remove Custom metadata or replay a removal.');
      };
      if (operation === 'preview_custom_metadata_changes') {
        const { filter, changes } = parsePreview(raw);
        if (changes.some(c => c.action === 'remove')) requireRemove();
        const db = await requireDb();
        const notes = await db.getAll('notes');
        if (filter.note_ids?.some(id => !notes.some(n => n.id === id))) fail('NOT_FOUND', 'A specified note ID was not found.');
        const selected: { note: Note; entries: CustomMetadataEntry[] }[] = [];
        for (const note of notes) {
          if (!basicMatch(note, filter)) continue;
          const entries = metadata(note);
          if (!metadataMatch(entries, filter.custom_metadata)) continue;
          selected.push({ note, entries });
          if (selected.length > 50) fail('TOO_MANY_MATCHES', 'More than 50 notes match. Narrow the selection.');
        }
        selected.sort((a, b) => a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0);
        const items: Item[] = [];
        const nextMetadata = new Map<string, CustomMetadataEntry[]>();
        for (const { note, entries } of selected) {
          if (bytes(note.body) > 131072) fail('NOTE_TOO_LARGE', 'A selected note body exceeds 128 KiB.');
          const proposed = propose(entries, changes);
          items.push({ id: note.id, title: note.title, expected_revision: await noteRevision(note), status: proposed.status, changes: proposed.diffs });
          if (proposed.status === 'changed') nextMetadata.set(note.id, proposed.next);
        }
        const changed_notes = nextMetadata.size;
        const result: MetadataPreviewResult = { status: changed_notes ? 'ready' : items.length ? 'no_changes' : 'no_matches',
          plan_id: null, matched_notes: items.length, changed_notes,
          unchanged_notes: items.filter(i => i.status === 'unchanged').length,
          skipped_notes: items.filter(i => i.status === 'skipped').length, items };
        authorize();
        if (changed_notes) {
          const now = Date.now();
          for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
          const planBytes = bytes(items) + bytes([...nextMetadata]);
          if (plans.size >= 5 || planBytes > MAX_PLAN_BYTES || [...plans.values()].reduce((n, p) => n + p.bytes, planBytes) > MAX_SESSION_BYTES) {
            fail('PLAN_LIMIT_EXCEEDED', 'Too many or too large pending plans. Narrow the selection or reconnect.');
          }
          result.plan_id = `cmdp_${crypto.randomUUID()}`;
          result.expires_at = now + PLAN_TTL;
          bounded(result);
          plans.set(result.plan_id, { expiresAt: result.expires_at, items, metadata: nextMetadata, bytes: planBytes, applied: false });
        }
        return structuredClone(bounded(result));
      }
      if (operation !== 'apply_custom_metadata_changes') fail('UNSUPPORTED_OPERATION', 'Unknown metadata operation.');
      const input = object(raw); keys(input, ['plan_id', 'request_id']);
      const { plan_id, request_id } = input;
      if (typeof plan_id !== 'string' || !/^cmdp_[a-f0-9-]{36}$/.test(plan_id) ||
        typeof request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(request_id)) invalid();
      const planId = plan_id as string;
      const key = `custom-metadata:${request_id}`;
      const fingerprint = await digest({ operation, plan_id: planId });
      const reuse = (receipt: McpReceipt): MetadataApplyResult => {
        if (receipt.digest !== fingerprint || receipt.result.status !== 'applied') fail('REQUEST_ID_CONFLICT', 'Request ID already used for different input.');
        if (receipt.result.removed_fields !== undefined) requireRemove();
        return { ...receipt.result, reused: true };
      };
      const db = await requireDb();
      const prior = await db.get('mcpReceipts', key);
      if (prior) { authorize(); return reuse(prior); }
      const plan = plans.get(planId);
      if (!plan) return fail('PLAN_NOT_FOUND', 'Plan not found. Preview again.');
      const hasRemove = plan.items.some(i => i.changes.some(c => c.action === 'remove'));
      if (hasRemove) requireRemove();
      if (plan.expiresAt <= Date.now()) return fail('PLAN_EXPIRED', 'Plan expired. Preview again.');
      if (plan.applied) return fail('PLAN_ALREADY_APPLIED', 'Plan already applied. Retry the original request_id.');
      const snapshots: Note[] = [];
      const nextNotes: Note[] = [];
      const items: MetadataApplyResult['items'] = [];
      const updatedAt = Date.now();
      for (const item of plan.items) {
        const snapshot = await db.get('notes', item.id);
        if (!snapshot || await noteRevision(snapshot) !== item.expected_revision) fail('CONFLICT', 'A selected note changed. No notes were updated. Preview again.');
        snapshots.push(snapshot);
        const next = item.status === 'changed' ? { ...snapshot, customMetadata: plan.metadata.get(item.id)!, updatedAt } : snapshot;
        nextNotes.push(next);
        items.push({ id: item.id, status: item.status === 'changed' ? 'updated' : item.status,
          previous_revision: item.expected_revision, revision: next === snapshot ? item.expected_revision : await noteRevision(next), updated_at: next.updatedAt });
      }
      const result: MetadataApplyResult = bounded({ status: 'applied', plan_id: planId, matched_notes: items.length,
        updated_notes: items.filter(i => i.status === 'updated').length, unchanged_notes: items.filter(i => i.status === 'unchanged').length,
        skipped_notes: items.filter(i => i.status === 'skipped').length,
        added_fields: plan.items.flatMap(i => i.changes).filter(c => c.result === 'added').length,
        updated_fields: plan.items.flatMap(i => i.changes).filter(c => c.result === 'updated').length,
        ...(hasRemove ? { removed_fields: plan.items.flatMap(i => i.changes).filter(c => c.result === 'removed').length } : {}), reused: false, items });
      const receipt: MetadataReceipt = { key, digest: fingerprint, result };
      authorize();
      const releases: (() => void)[] = [];
      try {
        for (const item of plan.items) {
          try { releases.push(acquireNoteUpdate(item.id)); } catch { fail('NOTE_BUSY', 'Finish editing or saving the selected notes, then preview again.'); }
        }
        const tx = db.transaction(['notes', 'mcpReceipts'], 'readwrite');
        try {
          const existing = await tx.objectStore('mcpReceipts').get(key);
          let committed: MetadataApplyResult;
          if (existing) { authorize(); committed = reuse(existing); }
          else {
            authorize();
            if (hasRemove) requireRemove();
            if (plan.applied) fail('PLAN_ALREADY_APPLIED', 'Plan already applied. Retry the original request_id.');
            if (plan.expiresAt <= Date.now()) fail('PLAN_EXPIRED', 'Plan expired. Preview again.');
            for (const snapshot of snapshots) assertSnapshot(await tx.objectStore('notes').get(snapshot.id), snapshot);
            authorize();
            for (let i = 0; i < items.length; i++) if (items[i].status === 'updated') await tx.objectStore('notes').put(nextNotes[i]);
            authorize();
            await tx.objectStore('mcpReceipts').add(receipt);
            authorize();
            committed = result;
          }
          await tx.done;
          plan.applied = true;
          notifyNotesChanged();
          return committed;
        } catch (error) {
          try { tx.abort(); } catch { /* already completed */ }
          await tx.done.catch(() => {});
          throw error;
        }
      } finally { releases.reverse().forEach(release => release()); }
    },
  };
}
