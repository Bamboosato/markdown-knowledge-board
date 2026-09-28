import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { remark } from "remark";

import { remarkSingleLineHighlight } from "../remarkSingleLineHighlight";
import { remarkMark } from "remark-mark-highlight";
import type {
  MarkdownPosition,
  StyledExportIssue,
  StyledLinkReference,
  StyledMarkdownAnalysis,
  StyledImageReference,
} from "./types";

type PositionNode = {
  type?: string;
  depth?: number;
  lang?: string | null;
  value?: string;
  url?: string;
  identifier?: string;
  children?: PositionNode[];
  position?: { start?: { line?: number; column?: number } };
};

function getPosition(node: PositionNode): MarkdownPosition {
  return {
    line: node.position?.start?.line ?? 1,
    column: node.position?.start?.column ?? 1,
  };
}

export function nodeReferenceId(position: MarkdownPosition, value: string): string {
  return `${position.line}:${position.column}:${value}`;
}

export function slugifyHeading(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function getText(node: PositionNode): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(getText).join("");
}

function isAllowedExternalLink(url: string): boolean {
  return /^(?:https?:|mailto:)/i.test(url) || url.startsWith("//");
}

function isUnsafeLink(url: string): boolean {
  return /^(?:javascript|vbscript|data|file|blob):/i.test(url.trim());
}

export function analyzeStyledMarkdown(markdown: string): StyledMarkdownAnalysis {
  const tree = remark()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMark)
    .use(remarkSingleLineHighlight)
    .parse(markdown) as unknown as PositionNode;
  const images: StyledImageReference[] = [];
  const links: StyledLinkReference[] = [];
  const issues: StyledExportIssue[] = [];
  const headingIds = new Map<number, string>();
  const headingIdBySlug = new Map<string, string>();
  const usedIds = new Map<string, number>();
  const mermaidCodes: string[] = [];
  const definitions = new Map<string, string>();
  let firstH1Text = "";
  let firstH1Line: number | null = null;

  for (const node of tree.children ?? []) {
    if (node.type !== "heading" || node.depth !== 1) continue;
    const text = getText(node).trim();
    if (!text) continue;
    firstH1Text = text;
    firstH1Line = getPosition(node).line;
    break;
  }

  const collectHeadings = (node: PositionNode) => {
    const position = getPosition(node);
    if (node.type === "heading") {
      const base = slugifyHeading(getText(node)) || `section-${position.line}`;
      const count = usedIds.get(base) ?? 0;
      usedIds.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      headingIds.set(position.line, id);
      if (!headingIdBySlug.has(base)) headingIdBySlug.set(base, id);
      headingIdBySlug.set(id, id);
    }
    node.children?.forEach(collectHeadings);
  };

  collectHeadings(tree);

  const collectDefinitions = (node: PositionNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
    node.children?.forEach(collectDefinitions);
  };
  collectDefinitions(tree);

  const visit = (node: PositionNode) => {
    const position = getPosition(node);

    if (node.type === "code" && /^mermaid$/i.test(node.lang ?? "")) {
      mermaidCodes.push(node.value ?? "");
    }

    const resolvedImageUrl = node.type === "image"
      ? node.url
      : node.type === "imageReference" && node.identifier
        ? definitions.get(node.identifier.toLowerCase())
        : undefined;
    if ((node.type === "image" || node.type === "imageReference") && resolvedImageUrl) {
      images.push({
        id: nodeReferenceId(position, resolvedImageUrl),
        url: resolvedImageUrl,
        position,
      });
    }

    const resolvedLinkUrl = node.type === "link"
      ? node.url
      : node.type === "linkReference" && node.identifier
        ? definitions.get(node.identifier.toLowerCase())
        : undefined;
    if ((node.type === "link" || node.type === "linkReference") && resolvedLinkUrl) {
      let kind: StyledLinkReference["kind"] | null = null;
      if (isUnsafeLink(resolvedLinkUrl)) kind = "unsafe";
      else if (resolvedLinkUrl.startsWith("#")) {
        let target = "";
        try {
          target = slugifyHeading(decodeURIComponent(resolvedLinkUrl.slice(1)));
        } catch {
          target = slugifyHeading(resolvedLinkUrl.slice(1));
        }
        if (!headingIdBySlug.has(target) && !/^user-content-(?:fn|fnref)-[\w-]+$/i.test(target)) {
          issues.push({
            id: nodeReferenceId(position, resolvedLinkUrl),
            kind: "local-link",
            reference: resolvedLinkUrl,
            position,
            reason: "The document anchor could not be found.",
          });
        }
      } else if (!isAllowedExternalLink(resolvedLinkUrl)) kind = "local";

      if (kind) {
        const reference: StyledLinkReference = {
          id: nodeReferenceId(position, resolvedLinkUrl),
          url: resolvedLinkUrl,
          position,
          kind,
        };
        links.push(reference);
        issues.push({
          id: reference.id,
          kind: kind === "unsafe" ? "unsafe-link" : "local-link",
          reference: resolvedLinkUrl,
          position,
          reason:
            kind === "unsafe"
              ? "This link scheme is not allowed in a standalone document."
              : "The linked local file or note is not included in this document.",
        });
      }
    }

    node.children?.forEach(visit);
  };

  visit(tree);
  return { images, links, mermaidCodes, firstH1Text, firstH1Line, headingIds, headingIdBySlug, issues };
}

export function createStyledExportRemarkPlugins() {
  return [remarkGfm, remarkMark, remarkSingleLineHighlight] as const;
}
