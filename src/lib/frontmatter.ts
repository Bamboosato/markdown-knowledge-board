import yaml from "js-yaml";

import {
  DEFAULT_MARP_SETTINGS,
  MARP_HEADING_DIVIDERS,
  MARP_SIZES,
  MARP_THEMES,
  getNoteMarpSettings,
} from "./types";
import type {
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
  body: string;
};

const FRONTMATTER_DELIMITER = "---";

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
  const data = yaml.load(frontmatterText);
  return { data, body };
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

  return {
    id,
    title,
    tags,
    updatedAt,
    marp,
    body: parsed.body,
  };
}

export function toMarkdownWithFrontmatter(note: Note): string {
  const frontmatter: Record<string, unknown> = {
    id: note.id,
    updatedAt: new Date(note.updatedAt).toISOString(),
  };
  const trimmedTitle = note.title.trim();
  if (trimmedTitle.length > 0) {
    frontmatter.title = note.title;
  }
  if (note.tags.length > 0) {
    frontmatter.tags = note.tags;
  }
  const marp = getNoteMarpSettings(note);
  if (marp.enabled) {
    frontmatter.marp = true;
    frontmatter.theme = marp.theme;
    frontmatter.size = marp.size;
    frontmatter.paginate = marp.paginate;
    if (marp.headingDivider !== false) {
      frontmatter.headingDivider = marp.headingDivider;
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
