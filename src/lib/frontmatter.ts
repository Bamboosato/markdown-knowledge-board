import yaml from "js-yaml";

import {
  DEFAULT_MARP_SETTINGS,
  MARP_HEADING_DIVIDERS,
  MARP_SIZES,
  MARP_THEMES,
  getNoteMarpSettings,
} from "./types";
import type {
  CustomMetadataEntry,
  FrontmatterValue,
  MarpHeadingDivider,
  MarpSettings,
  MarpSize,
  MarpTheme,
  Note,
} from "./types";

type FrontmatterParseResult = {
  id?: string;
  title?: string;
  tags?: string[];
  updatedAt?: number;
  marp?: MarpSettings;
  customMetadata?: CustomMetadataEntry[];
  body: string;
};

export type FrontmatterEntry = {
  key: string;
  value: FrontmatterValue;
  source: "system" | "edit" | "slides" | "custom";
  includedInExport: boolean;
};

export const RESERVED_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "tags",
  "updatedAt",
  "marp",
  "theme",
  "size",
  "paginate",
  "headingDivider",
]);

export const UNSAFE_FRONTMATTER_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const FRONTMATTER_DELIMITER = "---";
const MAX_EXPANDED_METADATA_VALUES = 10_000;
const MAX_EXPANDED_METADATA_CHARACTERS = 1_000_000;

/** Bound occurrences, not unique objects: copying or noRefs output expands aliases. */
export function assertFrontmatterExpansion(value: unknown): void {
  const pending: Array<{ value: unknown; exit?: boolean }> = [];
  const ancestors = new Set<object>();
  let values = 0;
  let characters = 0;

  const addCharacters = (length: number) => {
    characters += length;
    if (characters > MAX_EXPANDED_METADATA_CHARACTERS) {
      throw new Error("Metadata expands beyond the 1,000,000-character limit.");
    }
  };
  const enqueue = (item: unknown) => {
    if (++values > MAX_EXPANDED_METADATA_VALUES) {
      throw new Error("Metadata expands beyond the 10,000-value limit.");
    }
    if (typeof item === "string") addCharacters(item.length);
    pending.push({ value: item });
  };

  enqueue(value);
  while (pending.length > 0) {
    const current = pending.pop()!;
    const item = current.value;
    if (!item || typeof item !== "object") continue;
    if (current.exit) {
      ancestors.delete(item);
      continue;
    }
    if (ancestors.has(item)) {
      throw new Error("Metadata contains a circular reference.");
    }
    ancestors.add(item);
    pending.push({ value: item, exit: true });
    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index -= 1) {
        enqueue(item[index]);
      }
    } else {
      for (const [key, child] of Object.entries(item)) {
        addCharacters(key.length);
        enqueue(child);
      }
    }
  }
}

function loadFrontmatterYaml(text: string): unknown {
  const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  // Check the entire graph before reserved-field filtering or recursive copying.
  assertFrontmatterExpansion(parsed);
  return parsed;
}

function parseFrontmatterBlock(text: string): {
  data: unknown;
  body: string;
} | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return null;
  }

  const endIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER
  );
  if (endIndex === -1) {
    return null;
  }

  const frontmatterText = lines.slice(1, endIndex).join("\n");
  const body = lines.slice(endIndex + 1).join("\n");
  const data = loadFrontmatterYaml(frontmatterText);
  return { data, body };
}

function normalizeFrontmatterValue(
  value: unknown,
  depth = 0
): FrontmatterValue {
  if (depth > 20) {
    throw new Error("Metadata nesting is too deep.");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1000) {
      throw new Error("Metadata contains too many array items.");
    }
    return value.map((item) => normalizeFrontmatterValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Metadata contains an unsupported value.");
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1000) {
      throw new Error("Metadata contains too many fields.");
    }
    const result: Record<string, FrontmatterValue> = Object.create(null);
    for (const [key, item] of entries) {
      if (UNSAFE_FRONTMATTER_KEYS.has(key)) {
        throw new Error(`Metadata key is not allowed: ${key}`);
      }
      result[key] = normalizeFrontmatterValue(item, depth + 1);
    }
    return result;
  }
  throw new Error("Metadata contains an unsupported value.");
}

export function parseFrontmatterValueText(text: string): FrontmatterValue {
  if (text.trim().length === 0) {
    return "";
  }
  const parsed = loadFrontmatterYaml(text);
  return normalizeFrontmatterValue(parsed);
}

export function serializeFrontmatterValue(value: FrontmatterValue): string {
  assertFrontmatterExpansion(value);
  return yaml
    .dump(value, {
      flowLevel: 0,
      lineWidth: -1,
      noRefs: true,
      schema: yaml.JSON_SCHEMA,
    })
    .trimEnd();
}

export function cloneCustomMetadata(
  entries: CustomMetadataEntry[] | undefined
): CustomMetadataEntry[] {
  assertFrontmatterExpansion(entries ?? []);
  return (entries ?? []).map((entry) => ({
    key: entry.key,
    value: normalizeFrontmatterValue(entry.value),
  }));
}

export function areCustomMetadataEqual(
  left: CustomMetadataEntry[] | undefined,
  right: CustomMetadataEntry[] | undefined
): boolean {
  assertFrontmatterExpansion(left ?? []);
  assertFrontmatterExpansion(right ?? []);
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function toNumberTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function isMarpTheme(value: unknown): value is MarpTheme {
  return (
    typeof value === "string" &&
    (MARP_THEMES as readonly string[]).includes(value)
  );
}

function isMarpSize(value: unknown): value is MarpSize {
  return (
    typeof value === "string" && (MARP_SIZES as readonly string[]).includes(value)
  );
}

function isMarpHeadingDivider(value: unknown): value is MarpHeadingDivider {
  return (
    typeof value === "number" &&
    (MARP_HEADING_DIVIDERS as readonly number[]).includes(value)
  );
}

function parseMarpSettings(data: Record<string, unknown>): MarpSettings | undefined {
  if (typeof data.marp !== "boolean") {
    return undefined;
  }

  return {
    enabled: data.marp,
    theme: isMarpTheme(data.theme) ? data.theme : DEFAULT_MARP_SETTINGS.theme,
    size: isMarpSize(data.size) ? data.size : DEFAULT_MARP_SETTINGS.size,
    paginate:
      typeof data.paginate === "boolean"
        ? data.paginate
        : DEFAULT_MARP_SETTINGS.paginate,
    headingDivider: isMarpHeadingDivider(data.headingDivider)
      ? data.headingDivider
      : DEFAULT_MARP_SETTINGS.headingDivider,
  };
}

export function parseMarkdownWithFrontmatter(
  text: string
): FrontmatterParseResult {
  const parsed = parseFrontmatterBlock(text);
  if (!parsed) {
    return { body: text };
  }

  const data =
    parsed.data && typeof parsed.data === "object" ? parsed.data : {};
  const id =
    typeof (data as { id?: unknown }).id === "string"
      ? (data as { id: string }).id
      : undefined;
  const title =
    typeof (data as { title?: unknown }).title === "string"
      ? (data as { title: string }).title
      : undefined;
  const tagsRaw = (data as { tags?: unknown }).tags;
  const tags =
    Array.isArray(tagsRaw) && tagsRaw.every((tag) => typeof tag === "string")
      ? (tagsRaw as string[])
      : undefined;
  const updatedAt = toNumberTimestamp((data as { updatedAt?: unknown }).updatedAt);
  const marp = parseMarpSettings(data as Record<string, unknown>);
  const customMetadata = Object.entries(data as Record<string, unknown>)
    .filter(([key]) => !RESERVED_FRONTMATTER_KEYS.has(key))
    .map(([key, value]) => {
      if (UNSAFE_FRONTMATTER_KEYS.has(key)) {
        throw new Error(`Metadata key is not allowed: ${key}`);
      }
      return { key, value: normalizeFrontmatterValue(value) };
    });
  // Validate the representation used by storage, copying and equality as well.
  assertFrontmatterExpansion(customMetadata);

  return {
    id,
    title,
    tags,
    updatedAt,
    marp,
    customMetadata,
    body: parsed.body,
  };
}

export function buildFrontmatterEntries(note: Note): FrontmatterEntry[] {
  assertFrontmatterExpansion(note.customMetadata ?? []);
  const entries: FrontmatterEntry[] = [
    {
      key: "id",
      value: note.id,
      source: "system",
      includedInExport: true,
    },
    {
      key: "title",
      value: note.title,
      source: "edit",
      includedInExport: note.title.trim().length > 0,
    },
    {
      key: "tags",
      value: note.tags,
      source: "edit",
      includedInExport: note.tags.length > 0,
    },
    {
      key: "updatedAt",
      value: new Date(note.updatedAt).toISOString(),
      source: "system",
      includedInExport: true,
    },
  ];

  const marp = getNoteMarpSettings(note);
  if (marp.enabled) {
    entries.push(
      { key: "marp", value: true, source: "slides", includedInExport: true },
      {
        key: "theme",
        value: marp.theme,
        source: "slides",
        includedInExport: true,
      },
      {
        key: "size",
        value: marp.size,
        source: "slides",
        includedInExport: true,
      },
      {
        key: "paginate",
        value: marp.paginate,
        source: "slides",
        includedInExport: true,
      }
    );
    if (marp.headingDivider !== false) {
      entries.push({
        key: "headingDivider",
        value: marp.headingDivider,
        source: "slides",
        includedInExport: true,
      });
    }
  }

  for (const custom of note.customMetadata ?? []) {
    entries.push({
      key: custom.key,
      value: normalizeFrontmatterValue(custom.value),
      source: "custom",
      includedInExport: true,
    });
  }
  return entries;
}

export function toMarkdownWithFrontmatter(note: Note): string {
  const frontmatter: Record<string, unknown> = Object.create(null);
  for (const entry of buildFrontmatterEntries(note)) {
    if (entry.includedInExport) {
      frontmatter[entry.key] = entry.value;
    }
  }

  const body = note.body ?? "";
  const startsWithHeading = /^#\s+/.test(body);
  const headingLine = `# ${note.title}`;
  const needsHeading = !startsWithHeading;
  const bodyPrefix = needsHeading ? `${headingLine}\n\n` : "";
  const bodyText = body ? `${body}` : "";
  const frontmatterText = yaml
    .dump(frontmatter, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    .trimEnd();

  return `${FRONTMATTER_DELIMITER}\n${frontmatterText}\n${FRONTMATTER_DELIMITER}\n${bodyPrefix}${bodyText}`;
}
