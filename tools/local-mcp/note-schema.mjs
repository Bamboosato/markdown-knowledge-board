import { z } from 'zod';

export const noteShape = {
  request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(131072).refine(v => v.trim().length > 0 && Buffer.byteLength(v) <= 131072, 'Markdown must be nonempty and at most 128 KiB.'),
  tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
};
export const noteSchema = z.object(noteShape);

const noteId = z.string().min(1).max(65536);
const tagList = z.array(z.string().trim().min(1).max(80)).max(32);
export const accessSchemas = {
  search_notes: z.object({ query: z.string().max(200).optional(), scope: z.enum(['title', 'title_body']).optional(),
    tags: tagList.optional(), limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  get_note: z.object({ note_id: noteId }).strict(),
  update_note: z.object({ note_id: noteId, request_id: noteShape.request_id,
    expected_revision: z.string().regex(/^v1-[a-f0-9]{64}$/),
    title: noteShape.title.optional(), tags: tagList.optional(),
    body: z.string().max(131072).refine(v => Buffer.byteLength(v) <= 131072).optional(),
  }).strict().refine(v => ['title', 'body', 'tags'].some(key => key in v)),
};

const revision = z.string().regex(/^v1-[a-f0-9]{64}$/);
const summary = z.object({ id: noteId, title: z.string(), tags: z.array(z.string()), updated_at: z.number(),
  snippet: z.string(), body_bytes: z.number().int().nonnegative() }).strict();
export const accessResults = {
  search_notes: z.object({ items: z.array(summary).max(50), total: z.number().int().nonnegative(), next_offset: z.number().int().nonnegative().nullable() }).strict(),
  get_note: z.object({ id: noteId, title: z.string(), body: z.string().refine(v => Buffer.byteLength(v) <= 131072),
    tags: z.array(z.string()), updated_at: z.number(), revision, body_bytes: z.number().int().nonnegative(),
    pinned_at: z.number().optional(), marp: z.object({ enabled: z.boolean(), theme: z.string(), size: z.string(), paginate: z.boolean(), headingDivider: z.union([z.number(), z.literal(false)]) }).strict().optional(),
    custom_metadata: z.array(z.object({ key: z.string(), value: z.unknown() }).strict()).optional() }).strict(),
  update_note: z.object({ status: z.enum(['updated', 'unchanged']), id: noteId, title: z.string(), previous_revision: revision,
    revision, updated_at: z.number(), reused: z.boolean() }).strict(),
};
export const accessError = z.object({ error: z.object({ code: z.enum(['ACCESS_DISABLED', 'INVALID_ARGUMENT', 'NOT_FOUND',
  'STORAGE_UNAVAILABLE', 'SAVE_FAILED', 'CONFLICT', 'NOTE_BUSY', 'REQUEST_ID_CONFLICT', 'NOTE_TOO_LARGE', 'RESPONSE_TOO_LARGE', 'UNSUPPORTED_OPERATION']), message: z.string().max(500) }).strict() }).strict();
