import { z } from 'zod';

// Iterative validation bounds work before deep cloning/parsing a JSON metadata value.
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const managedKeys = new Set(['id', 'title', 'tags', 'updatedAt', 'pinnedAt', 'marp', 'theme', 'size', 'paginate', 'headingDivider']);
function isMetadataValue(value) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  let characters = 0;
  while (pending.length) {
    const { value: v, depth } = pending.pop();
    if (++count > 10000 || depth > 20) return false;
    if (typeof v === 'string') characters += v.length;
    else if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) { /* primitive */ }
    else if (Array.isArray(v)) {
      if (v.length > 1000) return false;
      for (const child of v) pending.push({ value: child, depth: depth + 1 });
    } else if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      const entries = Object.entries(v);
      if (entries.length > 1000) return false;
      for (const [key, child] of entries) {
        if (unsafeKeys.has(key)) return false;
        characters += key.length;
        pending.push({ value: child, depth: depth + 1 });
      }
    } else return false;
    if (characters > 1000000) return false;
  }
  return true;
}
const value = z.unknown().refine(isMetadataValue, 'Expected a bounded JSON metadata value.');
const key = z.string().min(1).max(100);
const writeKey = key.refine(k => k.trim() === k && !managedKeys.has(k) && !unsafeKeys.has(k));
export const metadataActions = ['add', 'update', 'upsert', 'remove'];
const action = z.enum(metadataActions);
const noteId = z.string().min(1).max(65536);
const revision = z.string().regex(/^v1-[a-f0-9]{64}$/);
const planId = z.string().regex(/^cmdp_[a-f0-9-]{36}$/);
const count = z.number().int().nonnegative();
const condition = z.union([
  z.object({ key, op: z.enum(['exists', 'missing']) }).strict(),
  z.object({ key, op: z.literal('equals'), value }).strict(),
  z.object({ key, op: z.literal('contains'), value: z.string().min(1).max(10000) }).strict(),
]);
const range = z.object({ gte: z.number().int().safe().optional(), lt: z.number().int().safe().optional() }).strict()
  .refine(v => Object.keys(v).length > 0 && (v.gte === undefined || v.lt === undefined || v.gte < v.lt));
const filter = z.object({
  note_ids: z.array(noteId).min(1).max(50).optional(), query: z.string().max(200).trim().min(1).optional(),
  scope: z.enum(['title', 'title_body']).optional(), tags: z.array(z.string().max(80).trim().min(1)).min(1).max(32).optional(),
  updated_at: range.optional(), custom_metadata: z.array(condition).min(1).max(20).optional(), all_notes: z.literal(true).optional(),
}).strict().refine(v => Object.keys(v).length > 0 && (!v.scope || v.query) && (!v.all_notes || Object.keys(v).length === 1));
export const metadataSchemas = {
  preview_custom_metadata_changes: z.object({ filter,
    changes: z.array(z.union([
      z.object({ action: z.enum(['add', 'update', 'upsert']), key: writeKey, value }).strict(),
      z.object({ action: z.literal('remove'), key: writeKey }).strict(),
    ])).min(1).max(20)
      .refine(v => new Set(v.map(c => c.key)).size === v.length),
  }).strict(),
  apply_custom_metadata_changes: z.object({ plan_id: planId, request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/) }).strict(),
};

const presence = z.union([z.object({ exists: z.literal(false) }).strict(), z.object({ exists: z.literal(true), value }).strict()]);
const diff = z.object({ action, key: writeKey, result: z.enum(['added', 'updated', 'removed', 'same_value', 'key_exists', 'key_missing']), before: presence, after: presence }).strict()
  .refine(v => v.action === 'remove' ? !v.after.exists && (v.before.exists ? v.result === 'removed' : v.result === 'key_missing') : v.result !== 'removed');
const counts = { matched_notes: count.max(50), unchanged_notes: count.max(50), skipped_notes: count.max(50) };
export const metadataResults = {
  preview_custom_metadata_changes: z.object({ ...counts, status: z.enum(['ready', 'no_matches', 'no_changes']),
    plan_id: planId.nullable(), expires_at: z.number().int().optional(), changed_notes: count.max(50),
    items: z.array(z.object({ id: noteId, title: z.string(), expected_revision: revision,
      status: z.enum(['changed', 'unchanged', 'skipped']), changes: z.array(diff).min(1).max(20) }).strict()).max(50),
  }).strict().refine(v => v.items.length === v.matched_notes &&
    v.changed_notes === v.items.filter(i => i.status === 'changed').length &&
    v.unchanged_notes === v.items.filter(i => i.status === 'unchanged').length &&
    v.skipped_notes === v.items.filter(i => i.status === 'skipped').length &&
    (v.status === 'ready' ? v.plan_id !== null && v.expires_at !== undefined && v.changed_notes > 0 :
      v.plan_id === null && v.expires_at === undefined && v.changed_notes === 0 && (v.status === 'no_matches' ? v.matched_notes === 0 : v.matched_notes > 0))),
  apply_custom_metadata_changes: z.object({ ...counts, status: z.literal('applied'), plan_id: planId,
    updated_notes: count.max(50), added_fields: count.max(1000), updated_fields: count.max(1000), removed_fields: count.max(1000).optional(), reused: z.boolean(),
    items: z.array(z.object({ id: noteId, status: z.enum(['updated', 'unchanged', 'skipped']),
      previous_revision: revision, revision, updated_at: z.number() }).strict()).min(1).max(50),
  }).strict().refine(v => v.items.length === v.matched_notes && new Set(v.items.map(i => i.id)).size === v.items.length &&
    v.updated_notes === v.items.filter(i => i.status === 'updated').length &&
    v.unchanged_notes === v.items.filter(i => i.status === 'unchanged').length &&
    v.skipped_notes === v.items.filter(i => i.status === 'skipped').length),
};
