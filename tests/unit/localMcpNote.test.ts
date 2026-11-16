import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getAllNotes, getNote, saveNote } from '../../src/lib/db';
import { saveLocalMcpNote } from '../../src/lib/localMcpNote';

const input = (id: string) => ({
  request_id: id, title: '日本語の試作', markdown: '# 見出し\n\n本文 📝\n\n| A | B |\n|---|---|\n| 1 | 2 |', tags: ['試作'],
});

describe('local MCP create-only save', () => {
  it('persists Unicode Markdown and ignores an embedded existing ID', async () => {
    await saveNote({ id: 'existing', title: 'Original', body: 'Do not change', tags: [], updatedAt: 1 });
    const saved = await saveLocalMcpNote({ ...input('unicode-001'), markdown: '---\nid: existing\n---\n' + input('unicode-001').markdown });
    expect(saved.reused).toBe(false);
    expect(saved.note.id).not.toBe('existing');
    expect(await getNote(saved.note.id)).toEqual(saved.note);
    expect(saved.note.body).toBe(input('unicode-001').markdown);
    expect((await getNote('existing'))?.body).toBe('Do not change');
  });

  it('serializes concurrent retries into a single durable note', async () => {
    const before = (await getAllNotes()).length;
    const results = await Promise.all([saveLocalMcpNote(input('retry-0001')), saveLocalMcpNote(input('retry-0001'))]);
    expect(results.map(result => result.reused).sort()).toEqual([false, true]);
    expect(results[0].note).toEqual(results[1].note);
    expect((await getAllNotes()).length).toBe(before + 1);
  });

  it('rejects reused IDs with changed content and protects user edits', async () => {
    const saved = await saveLocalMcpNote(input('conflict-001'));
    await expect(saveLocalMcpNote({ ...input('conflict-001'), markdown: 'Changed' })).rejects.toThrow('Nothing was overwritten');
    await saveNote({ ...saved.note, body: 'User edit' });
    await expect(saveLocalMcpNote(input('conflict-001'))).rejects.toThrow('Nothing was overwritten');
    expect((await getNote(saved.note.id))?.body).toBe('User edit');
  });

  it('rejects empty and oversized input before writing', async () => {
    const before = (await getAllNotes()).length;
    for (const markdown of ['  ', 'あ'.repeat(43691)]) {
      await expect(saveLocalMcpNote({ ...input('invalid-001'), markdown })).rejects.toThrow();
    }
    expect((await getAllNotes()).length).toBe(before);
  });
});
