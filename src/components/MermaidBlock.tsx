import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MERMAID_CODE_SIZE_LIMIT_BYTES, renderMermaidSvg } from "../lib/mermaidRenderer";

const MERMAID_RENDER_DEBOUNCE_MS = 300;
type MermaidView = "diagram" | "code";

type RenderState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "too-large" };

type MermaidBlockProps = {
  code: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown render error.";
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function CodeView({ code }: MermaidBlockProps) {
  return (
    <pre className="mermaid-code">
      <code className="language-mermaid">{code}</code>
    </pre>
  );
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const reactId = useId();
  const instanceId = useMemo(
    () => reactId.replace(/[^A-Za-z0-9_-]/g, ""),
    [reactId]
  );
  const renderRequestRef = useRef(0);
  const [view, setView] = useState<MermaidView>("diagram");
  const [asyncRenderState, setAsyncRenderState] = useState<{
    code: string;
    state: RenderState;
  }>({
    code: "",
    state: { status: "loading" },
  });
  const diagramLabel = `Mermaid diagram ${instanceId || "preview"}`;
  const precheckedState = useMemo<RenderState | null>(() => {
    if (!code.trim()) {
      return { status: "empty" };
    }
    if (getUtf8ByteLength(code) > MERMAID_CODE_SIZE_LIMIT_BYTES) {
      return { status: "too-large" };
    }
    return null;
  }, [code]);
  const renderState =
    precheckedState ??
    (asyncRenderState.code === code
      ? asyncRenderState.state
      : { status: "loading" });

  useEffect(() => {
    renderRequestRef.current += 1;
    const requestId = renderRequestRef.current;

    if (precheckedState) {
      return;
    }

    let isCurrent = true;

    const timeoutId = window.setTimeout(async () => {
      try {
        const renderId = `mermaid-${instanceId}-${requestId}`;
        const sanitizedSvg = await renderMermaidSvg(code, renderId);

        if (isCurrent && renderRequestRef.current === requestId) {
          setAsyncRenderState({
            code,
            state: { status: "rendered", svg: sanitizedSvg },
          });
        }
      } catch (error) {
        if (isCurrent && renderRequestRef.current === requestId) {
          setAsyncRenderState({
            code,
            state: {
              status: "error",
              message: getErrorMessage(error),
            },
          });
        }
      }
    }, MERMAID_RENDER_DEBOUNCE_MS);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [code, instanceId, precheckedState]);

  const showDiagram = view === "diagram";

  return (
    <figure className="mermaid-block" data-mermaid-status={renderState.status}>
      <div className="mermaid-block-header">
        <figcaption>Mermaid</figcaption>
        <div className="mermaid-view-toggle" aria-label="Mermaid display mode">
          <button
            type="button"
            className={showDiagram ? "active" : ""}
            aria-label="Show Diagram"
            aria-pressed={showDiagram}
            onClick={() => setView("diagram")}
          >
            Diagram
          </button>
          <button
            type="button"
            className={view === "code" ? "active" : ""}
            aria-label="Show Code"
            aria-pressed={view === "code"}
            onClick={() => setView("code")}
          >
            Code
          </button>
        </div>
      </div>
      {showDiagram ? (
        <div className="mermaid-diagram-panel">
          {renderState.status === "loading" ? (
            <div className="mermaid-message" aria-live="polite">
              Rendering diagram...
            </div>
          ) : null}
          {renderState.status === "empty" ? (
            <div className="mermaid-message">Empty Mermaid diagram.</div>
          ) : null}
          {renderState.status === "too-large" ? (
            <div>
              <div className="mermaid-message error" role="alert">
                Diagram is too large to render automatically.
              </div>
              <CodeView code={code} />
            </div>
          ) : null}
          {renderState.status === "error" ? (
            <div className="mermaid-message error" role="alert">
              <strong>Unable to render Mermaid diagram.</strong>
              <span>{renderState.message}</span>
            </div>
          ) : null}
          {renderState.status === "rendered" ? (
            <div className="mermaid-diagram-scroll">
              <div
                className="mermaid-diagram-svg"
                role="img"
                aria-label={diagramLabel}
                dangerouslySetInnerHTML={{ __html: renderState.svg }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <CodeView code={code} />
      )}
    </figure>
  );
}
