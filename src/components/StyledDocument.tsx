import { isValidElement, useMemo } from "react";
import type { ReactNode } from "react";
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
  className = "styled-export-document",
}: StyledDocumentProps) {
  const style = useMemo(() => getThemeVariables(options), [options]);
  const hasMarkdownTitle = analysis.firstH1Line !== null && analysis.firstH1Text.trim().length > 0;
  const displayTitle = hasMarkdownTitle ? analysis.firstH1Text : title.trim() || "Untitled";

  return (
    <article className={className} style={style} data-color={options.colorId} data-design={options.designId}>
      <header className="styled-export-header">
        <h1
          className="styled-export-title"
          id={hasMarkdownTitle ? analysis.headingIds.get(analysis.firstH1Line!) : undefined}
        >
          {displayTitle}
        </h1>
        {options.showTags && tags.length > 0 ? (
          <ul className="styled-export-tags" aria-label="Tags">
            {tags.map((tag, index) => <li key={`${tag}-${index}`}>{tag}</li>)}
          </ul>
        ) : null}
      </header>
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
                return <h1 {...props} id={getHeadingId(node, analysis)}>{children}</h1>;
              },
              h2: ({ node, children, ...props }) => <h2 {...props} id={getHeadingId(node, analysis)}>{children}</h2>,
              h3: ({ node, children, ...props }) => <h3 {...props} id={getHeadingId(node, analysis)}>{children}</h3>,
              h4: ({ node, children, ...props }) => <h4 {...props} id={getHeadingId(node, analysis)}>{children}</h4>,
              h5: ({ node, children, ...props }) => <h5 {...props} id={getHeadingId(node, analysis)}>{children}</h5>,
              h6: ({ node, children, ...props }) => <h6 {...props} id={getHeadingId(node, analysis)}>{children}</h6>,
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
                    return svg
                      ? <div className="styled-export-mermaid" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
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
  return analysis.headingIds.get(getNodePosition(node).line);
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
