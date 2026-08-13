import { isValidElement, useMemo } from "react";
import type { MouseEvent, ReactNode, Ref } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkMark } from "remark-mark-highlight";

import { MermaidBlock } from "./MermaidBlock";
import { getTaskLineIndexes } from "../lib/markdownTasks";
import { remarkSingleLineHighlight } from "../lib/remarkSingleLineHighlight";

type MarkdownCodeElementProps = {
  className?: string;
  children?: ReactNode;
};

export type MarkdownPreviewMode = "interactive" | "print";

type MarkdownPreviewProps = {
  markdown: string;
  mode?: MarkdownPreviewMode;
  className?: string;
  previewRef?: Ref<HTMLDivElement>;
  onPreviewLinkClick?: (
    event: MouseEvent<HTMLAnchorElement>,
    href: string
  ) => void;
  onTaskToggle?: (lineIndex: number) => void;
};

export function MarkdownPreview({
  markdown,
  mode = "interactive",
  className = "mdPreview mdPreview-scroll",
  previewRef,
  onPreviewLinkClick,
  onTaskToggle,
}: MarkdownPreviewProps) {
  const draftLines = useMemo(() => markdown.split("\n"), [markdown]);
  const taskLineIndexes = useMemo(
    () => new Set(getTaskLineIndexes(markdown)),
    [markdown]
  );

  return (
    <div
      ref={previewRef}
      className={className}
      data-preview-mode={mode}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMark, remarkSingleLineHighlight]}
        components={{
          a: ({ href, onClick, ...props }) => (
            <a
              {...props}
              href={href}
              onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented || !href || !onPreviewLinkClick) {
                  return;
                }
                onPreviewLinkClick(event, href);
              }}
            />
          ),
          input: ({ checked }) =>
            mode === "print" ? (
              <span className="print-task-checkbox" aria-hidden="true">
                {checked ? "☑" : "☐"}
              </span>
            ) : null,
          pre: ({ children }) => {
            const codeElement = Array.isArray(children)
              ? children[0]
              : children;
            if (isValidElement<MarkdownCodeElementProps>(codeElement)) {
              const languageMatch = /language-(\S+)/i.exec(
                codeElement.props.className ?? ""
              );
              const language = languageMatch?.[1]?.toLowerCase();
              if (language === "mermaid") {
                const code = String(
                  codeElement.props.children ?? ""
                ).replace(/\n$/, "");
                return <MermaidBlock code={code} />;
              }
            }
            return <pre>{children}</pre>;
          },
          li: ({ node, children, ...props }) => {
            const className = props.className ?? "";
            const isTask = className.includes("task-list-item");

            if (!isTask || mode === "print" || !onTaskToggle) {
              return <li className={className}>{children}</li>;
            }

            const startLine = (
              node as { position?: { start?: { line?: number } } }
            )?.position?.start?.line;
            const lineIndex =
              typeof startLine === "number" ? startLine - 1 : NaN;
            const isTaskLine =
              Number.isFinite(lineIndex) && taskLineIndexes.has(lineIndex);
            const lineText = isTaskLine ? draftLines[lineIndex] ?? "" : "";
            const checked = /^\s*[-*]\s*\[x\]\s+/i.test(lineText);

            return (
              <li className={className}>
                <button
                  type="button"
                  className="taskCheckbox"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`${
                    checked ? "Mark task incomplete" : "Mark task complete"
                  }: ${getTaskLabelText(lineText)}`}
                  disabled={!Number.isFinite(lineIndex)}
                  onClick={() => {
                    if (Number.isFinite(lineIndex)) {
                      onTaskToggle(lineIndex);
                    }
                  }}
                >
                  {checked ? "☑" : "☐"}
                </button>
                <span className="taskText">{children}</span>
              </li>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function getTaskLabelText(line: string): string {
  const text = line.replace(/^\s*[-*]\s*\[[ xX]\]\s+/, "").trim();
  return text || "Task";
}
