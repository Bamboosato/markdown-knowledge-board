export const CONTENT_FONT_SCALE_DEFAULT = 100;
export const CONTENT_FONT_SCALE_MIN = 80;
export const CONTENT_FONT_SCALE_MAX = 180;
export const CONTENT_FONT_SCALE_STEP = 10;
export const CONTENT_FONT_SCALE_STORAGE_KEY =
  "markdown-knowledge-board.content-font-scale.v1";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeContentFontScale(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return CONTENT_FONT_SCALE_DEFAULT;
  }

  const stepped =
    Math.round(parsed / CONTENT_FONT_SCALE_STEP) * CONTENT_FONT_SCALE_STEP;
  return Math.min(
    CONTENT_FONT_SCALE_MAX,
    Math.max(CONTENT_FONT_SCALE_MIN, stepped),
  );
}

export function getNextContentFontScale(
  current: unknown,
  deltaY: number,
): number {
  const normalized = normalizeContentFontScale(current);
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return normalized;
  }

  const direction = deltaY < 0 ? 1 : -1;
  return normalizeContentFontScale(
    normalized + direction * CONTENT_FONT_SCALE_STEP,
  );
}

export function readContentFontScale(
  storage: Pick<Storage, "getItem"> | null | undefined,
): number {
  if (!storage) {
    return CONTENT_FONT_SCALE_DEFAULT;
  }

  try {
    const stored = storage.getItem(CONTENT_FONT_SCALE_STORAGE_KEY);
    return stored === null
      ? CONTENT_FONT_SCALE_DEFAULT
      : normalizeContentFontScale(stored);
  } catch {
    return CONTENT_FONT_SCALE_DEFAULT;
  }
}
