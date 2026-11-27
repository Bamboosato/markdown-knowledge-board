import { getPinnedAt } from "./note";
import type { Note } from "./types";

export const noteGroups = ["pinned", "other"] as const;
export type NoteGroup = typeof noteGroups[number];
export type NoteOrder = Partial<Record<NoteGroup, string[]>>;

export function noteGroup(note: Pick<Note, "pinnedAt">): NoteGroup {
  return getPinnedAt(note) === undefined ? "other" : "pinned";
}

export function sortNotes(notes: readonly Note[], order: NoteOrder = {}): Note[] {
  const ranks = { pinned: new Map<string, number>(), other: new Map<string, number>() };
  for (const group of noteGroups) {
    order[group]?.forEach((id, index) => ranks[group].set(id, index));
  }
  return [...notes].sort((left, right) => {
    const group = noteGroup(left);
    if (group !== noteGroup(right)) return group === "pinned" ? -1 : 1;
    const rank = (ranks[group].get(left.id) ?? -1) - (ranks[group].get(right.id) ?? -1);
    return rank || (getPinnedAt(right) ?? 0) - (getPinnedAt(left) ?? 0)
      || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
  });
}

// Update membership only when a note enters or leaves a group.
export function updateOrderMembership(order: NoteOrder, before?: Note, after?: Note) {
  const from = before && noteGroup(before);
  const to = after && noteGroup(after);
  if (from === to) return;
  if (before && from && order[from]) {
    order[from] = order[from].filter(id => id !== before.id);
    if (!order[from].length) delete order[from];
  }
  if (after && to) order[to]?.unshift(after.id);
}

// Keep local-only and conflicting notes in their slots during a merge.
export function mergeNoteOrder(notes: Note[], local: NoteOrder, incoming: NoteOrder) {
  const ordered = sortNotes(notes, local);
  for (const group of noteGroups) {
    const ids = incoming[group];
    if (!ids?.length) continue;
    const current = ordered.filter(note => noteGroup(note) === group).map(note => note.id);
    const members = new Set(current);
    const restored = ids.filter(id => members.has(id));
    if (!restored.length) continue;
    const participating = new Set(restored);
    let index = 0;
    local[group] = current.map(id => participating.has(id) ? restored[index++] : id);
  }
}

export function readBackupOrder(value: unknown, notes: Pick<Note, "id" | "pinnedAt">[]): NoteOrder | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backup note order.");
  const groups = new Map(notes.map(note => [note.id, noteGroup(note)]));
  const order: NoteOrder = {};
  for (const [key, ids] of Object.entries(value)) {
    if ((key !== "pinned" && key !== "other") || !Array.isArray(ids) ||
        ids.some(id => typeof id !== "string" || groups.get(id) !== key) ||
        new Set(ids).size !== ids.length) throw new Error("Invalid backup note order.");
    if (ids.length) order[key] = ids;
  }
  return order;
}
