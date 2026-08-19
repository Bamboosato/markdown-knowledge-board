import type { Note } from "./types";

export function findNoteIndexById(notes: readonly Note[], id: string): number {
  return notes.findIndex((note) => note.id === id);
}

export function replaceNoteBody(
  currentNote: Note,
  body: string,
  updatedAt: number
): Note | null {
  if (currentNote.body === body) {
    return null;
  }

  return {
    ...currentNote,
    body,
    updatedAt,
  };
}
