import { addNewNoteOrReuse } from './db';
import { createNoteFromMarkdown } from './note';

export type LocalMcpInput = {
  request_id: string;
  title: string;
  markdown: string;
  tags: string[];
};

export async function saveLocalMcpNote(input: LocalMcpInput) {
  if (!input || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.request_id) ||
      typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 ||
      typeof input.markdown !== 'string' || !input.markdown.trim() ||
      new TextEncoder().encode(input.markdown).byteLength > 131072 ||
      !Array.isArray(input.tags) || input.tags.length > 32 ||
      input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80)) {
    throw new Error('Invalid local MCP note.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.request_id));
  const id = `mcp-${Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('')}`;
  const note = createNoteFromMarkdown(input.markdown, `${input.title}.md`, {
    id, title: input.title, tags: input.tags, updatedAt: Date.now(),
  });
  return addNewNoteOrReuse(note);
}
