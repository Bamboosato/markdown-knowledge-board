import { z } from 'zod';

export const noteShape = {
  request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(131072).refine(v => v.trim().length > 0 && Buffer.byteLength(v) <= 131072, 'Markdown must be nonempty and at most 128 KiB.'),
  tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
};
export const noteSchema = z.object(noteShape);
