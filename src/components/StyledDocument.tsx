import { isValidElement, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  createStyledExportRemarkPlugins,
  nodeReferenceId,
  slugifyHeading,
} from "../lib/styledExport/markdown";
import type {
  StyledAssetMap,
  StyledMarkdownAnalysis,
  StyledExportOptions,
  MarkdownPosition,
} from "../lib/styledExport/types";
import { getThemeVariables } from "../lib/styledExport/theme";
import { getMermaidPrintLayout } from "../lib/mermaidPrint";

type MarkdownNode = {
  position?: { start?: { line?: number; column?: number } };
};

type CodeElementProps = { className?: string; children?: ReactNode };

export type StyledDocumentProps = {
  title: string;
  tags: string[];
  markdown: string;
  options: StyledExportOptions;
  analysis: StyledMarkdownAnalysis;
  assets: StyledAssetMap;
  mermaidSvgs: Record<string, string>;
  allowLocalLinks: boolean;
  printGeometry?: { width: number; height: number };
  printMermaidAsCode?: boolean;
  coverPage?: boolean;
  tableOfContents?: boolean;
  tocDepth?: "h2" | "h2-h3";
  className?: string;
};

export function StyledDocument({
  title,
  tags,
  markdown,
  options,
  analysis,
  assets,
  mermaidSvgs,
  allowLocalLinks,
  printGeometry,
  printMermaidAsCode = false,
  coverPage = false,
  tableOfContents = false,
  tocDepth = "h2-h3",
  className = "styled-export-document",
}: StyledDocumentProps) {
  const style = useMemo(() => getThemeVariables(options), [options]);
  const hasMarkdownTitle = analysis.firstH1Line !== null && analysis.firstH1Text.trim().length > 0;
  const displayTitle = hasMarkdownTitle ? analysis.firstH1Text : title.trim() || "Untitled";
  const toc = analysis.tocEntries.filter((entry) => tocDepth === "h2-h3" || entry.level === 2);
  const groups: Array<{ entry: typeof toc[number]; children: typeof toc }> = [];
  for (const entry of toc) {
    const previous = groups.at(-1);
    if (entry.level === 3 && previous?.entry.level === 2) previous.children.push(entry);
    else groups.push({ entry, children: [] });
  }
  const header = (
    <header className={`styled-export-header${coverPage ? " styled-export-cover" : ""}`}>
      <h1 className="styled-export-title" id={hasMarkdownTitle ? analysis.headingIds.get(analysis.firstH1Line!) : undefined}>{displayTitle}</h1>
      {options.showTags && tags.length > 0 ? <ul className="styled-export-tags" aria-label="Tags">{tags.map((tag, index) => <li key={`${tag}-${index}`}>{tag}</li>)}</ul> : null}
    </header>
  );

  return (
    <article className={className} style={style} data-color={options.colorId} data-design={options.designId}>
      {coverPage ? header : null}
      {tableOfContents && toc.length ? <nav className="styled-export-toc" aria-label="Table of contents"><h2>目次</h2><ol>{groups.map(({ entry, children }) => <li key={entry.id} className={entry.level === 3 ? "styled-export-toc-leading-h3" : undefined}><a href={`#${entry.id}`}>{entry.label}</a>{children.length ? <ol>{children.map((child) => <li key={child.id}><a href={`#${child.id}`}>{child.label}</a></li>)}</ol> : null}</li>)}</ol></nav> : null}
      {!coverPage ? header : null}
      {markdown.trim() ? (
        <div className="styled-export-markdown">
          <ReactMarkdown
            remarkPlugins={[...createStyledExportRemarkPlugins()]}
        urlTransform={safeMarkdownUrlTransform}
            components={{
              h1: ({ node, children, ...props }) => {
                const position = getNodePosition(node);
                if (hasMarkdownTitle && position.line === analysis.firstH1Line) {
                  return null;
                }
                if (children == null || (Array.isArray(children) && children.length === 0) ||
                    (typeof children === "string" && !children.trim())) {
                  return null;
                }
                return <h1 {...props} id={getHeadingId(node, analysis) ?? props.id}>{children}</h1>;
              },
              h2: ({ node, children, ...props }) => <h2 {...props} id={getHeadingId(node, analysis) ?? props.id}>{children}</h2>,
              h3: ({ node, children, ...props }) => <h3 {...props} id={getHeadingId(node, analysis) ?? props.id}>{children}</h3>,
              h4: ({ node, children, ...props }) => <h4 {...props} id={getHeadingId(node, analysis) ?? props.id}>{children}</h4>,
              h5: ({ node, children, ...props }) => <h5 {...props} id={getHeadingId(node, analysis) ?? props.id}>{children}</h5>,
              h6: ({ node, children, ...props }) => <h6 {...props} id={getHeadingId(node, analysis) ?? props.id}>{children}</h6>,
              a: ({ node: _node, href, children, ...props }) => {
                void _node;
                const mappedHref = getExportHref(href, analysis, allowLocalLinks);
                return <a {...props} href={mappedHref}>{children}</a>;
              },
              img: ({ node, src, alt }) => {
                if (!src) return <span className="styled-export-missing-image">Missing image source</span>;
                const key = nodeReferenceId(getNodePosition(node), src);
                const resolved = assets[key];
                return resolved
                  ? <img src={resolved} alt={alt ?? ""} />
                  : <span className="styled-export-missing-image">Image needs to be resolved: {alt || src}</span>;
              },
              input: ({ checked }) => <span className="styled-export-checkbox" aria-label={checked ? "checked" : "not checked"}>{checked ? "☑" : "☐"}</span>,
              pre: ({ children }) => {
                const code = Array.isArray(children) ? children[0] : children;
                if (isValidElement<CodeElementProps>(code)) {
                  const language = /language-(\S+)/i.exec(code.props.className ?? "")?.[1]?.toLowerCase();
                  if (language === "mermaid") {
                    const source = String(code.props.children ?? "").replace(/\n$/, "");
                    const svg = mermaidSvgs[source];
                    // CSS min(100%, fitted width) also accounts for theme padding
                    // and nested containers, including viewport-relative padding.
                    const fit = svg ? getMermaidPrintLayout(svg, printGeometry) : null;
                    return svg
                      ? <div className="styled-export-mermaid" data-print-fallback={printMermaidAsCode || !fit ? "source" : undefined} style={fit ? { "--mermaid-print-width": `${fit.width}px` } as CSSProperties : undefined}>
                          {fit?.smallText && !printMermaidAsCode ? <p className="mermaid-print-warning">This diagram will fit on one printed page; text may be small. Review the PDF or choose “Print Mermaid as source”.</p> : null}
                          <div role="img" dangerouslySetInnerHTML={{ __html: svg }} />
                          <div className="mermaid-print-fallback"><pre><code>{source}</code></pre></div>
                        </div>
                      : <pre><code>{source}</code></pre>;
                  }
                }
                return <pre>{children}</pre>;
              },
              table: ({ children }) => <div className="styled-export-table-wrap"><table>{children}</table></div>,
            }}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      ) : <p className="styled-export-empty">Nothing to preview.</p>}
    </article>
  );
}

function getNodePosition(node: MarkdownNode | undefined): MarkdownPosition {
  return { line: node?.position?.start?.line ?? 1, column: node?.position?.start?.column ?? 1 };
}

function getHeadingId(node: MarkdownNode | undefined, analysis: StyledMarkdownAnalysis) {
  const line = node?.position?.start?.line;
  return line === undefined ? undefined : analysis.headingIds.get(line);
}

function getExportHref(
  href: string | undefined,
  analysis: StyledMarkdownAnalysis,
  allowLocalLinks: boolean
) {
  if (!href || /^(?:javascript|vbscript|data|file|blob):/i.test(href.trim())) return undefined;
  if (/^\/\//.test(href)) return `https:${href}`;
  if (/^(?:https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith("#")) {
    let target: string;
    try {
      target = slugifyHeading(decodeURIComponent(href.slice(1)));
    } catch {
      return undefined;
    }
    if (analysis.footnoteIds.has(target)) return `#${target}`;
    if (analysis.headingIdBySlug.has(target)) return `#${analysis.headingIdBySlug.get(target)}`;
    if (/^user-content-(?:fn|fnref)-[\w-]+$/i.test(target)) return `#${target}`;
    return undefined;
  }
  if (!allowLocalLinks) return undefined;
  return undefined;
}

function safeMarkdownUrlTransform(value: string): string {
  if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)(?:[;,])/i.test(value)) {
    return value;
  }
  if (/^(?:https?:|mailto:)/i.test(value) || value.startsWith("#")) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
  return value;
}
