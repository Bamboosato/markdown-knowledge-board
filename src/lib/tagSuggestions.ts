import type { Note } from "./types";

export type TagSuggestionCandidate = {
  tag: string;
  lastUsedAt: number;
};

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function buildTagSuggestionCandidates(
  notes: readonly Note[],
): TagSuggestionCandidate[] {
  const candidates = new Map<string, TagSuggestionCandidate>();

  for (const note of notes) {
    const updatedAt = Number.isFinite(note.updatedAt) ? note.updatedAt : 0;

    for (const tag of note.tags) {
      const normalized = normalizeTag(tag);
      if (!normalized) {
        continue;
      }

      const candidate = candidates.get(normalized);
      if (!candidate) {
        candidates.set(normalized, { tag, lastUsedAt: updatedAt });
      } else if (updatedAt > candidate.lastUsedAt) {
        candidate.lastUsedAt = updatedAt;
      }
    }
  }

  return Array.from(candidates.values()).sort((left, right) => {
    if (left.lastUsedAt !== right.lastUsedAt) {
      return right.lastUsedAt - left.lastUsedAt;
    }

    const nameOrder = left.tag.localeCompare(right.tag, undefined, {
      sensitivity: "base",
    });
    return nameOrder !== 0 ? nameOrder : left.tag.localeCompare(right.tag);
  });
}

export function getTagSuggestions(
  notes: readonly Note[],
  selectedTags: readonly string[],
  query: string,
  limit: number,
): string[] {
  const selectedTagKeys = new Set(selectedTags.map(normalizeTag));
  const normalizedQuery = normalizeTag(query);

  return buildTagSuggestionCandidates(notes)
    .filter(({ tag }) => {
      const normalized = normalizeTag(tag);
      return (
        !selectedTagKeys.has(normalized) &&
        (normalizedQuery.length === 0 || normalized.includes(normalizedQuery))
      );
    })
    .slice(0, limit)
    .map(({ tag }) => tag);
}
