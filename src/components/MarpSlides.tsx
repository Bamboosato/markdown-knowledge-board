import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import type { MarpSize, MarpTheme } from "../lib/types";

const MARP_RENDER_DEBOUNCE_MS = 300;
const MARP_BODY_SIZE_LIMIT_BYTES = 100 * 1024;

type MarpApi = typeof import("@marp-team/marp-core");

type SlideRenderState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "rendered"; html: string; css: string; slideCount: number }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "too-large" };

type MarpSlidesProps = {
  markdown: string;
  enabled: boolean;
  size: MarpSize;
  theme: MarpTheme;
  paginate: boolean;
  slideIndex: number;
  onSlideIndexChange: (index: number) => void;
};

let marpPromise: Promise<MarpApi> | null = null;

function loadMarp(): Promise<MarpApi> {
  if (!marpPromise) {
    marpPromise = import("@marp-team/marp-core");
  }
  return marpPromise;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown render error.";
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function getSlideCount(html: string): number {
  return html.match(/<svg\b[^>]*data-marpit-svg\b/gi)?.length ?? 0;
}

function stripLeadingMarpFrontmatter(markdown: string): string {
  const match = markdown.match(
    /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
  );
  if (!match) {
    return markdown;
  }

  const frontmatter = match[1];
  const hasMarpDirective = /^\s*(marp|theme|size|paginate)\s*:/m.test(
    frontmatter
  );
  if (!hasMarpDirective) {
    return markdown;
  }

  return markdown.slice(match[0].length);
}

function normalizeLightDarkForLightMode(css: string): string {
  const token = "light-dark(";
  let normalized = "";
  let cursor = 0;

  while (cursor < css.length) {
    const tokenIndex = css.indexOf(token, cursor);
    if (tokenIndex === -1) {
      normalized += css.slice(cursor);
      break;
    }

    normalized += css.slice(cursor, tokenIndex);

    const argsStart = tokenIndex + token.length;
    let depth = 0;
    let commaIndex = -1;
    let endIndex = -1;

    for (let index = argsStart; index < css.length; index += 1) {
      const char = css[index];

      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        if (depth === 0) {
          endIndex = index;
          break;
        }
        depth -= 1;
      } else if (char === "," && depth === 0 && commaIndex === -1) {
        commaIndex = index;
      }
    }

    if (commaIndex === -1 || endIndex === -1) {
      normalized += css.slice(tokenIndex);
      break;
    }

    normalized += css.slice(argsStart, commaIndex).trim();
    cursor = endIndex + 1;
  }

  return normalized;
}

function createMarpMarkdown(
  markdown: string,
  theme: MarpTheme,
  size: MarpSize,
  paginate: boolean
): string {
  const bodyMarkdown = stripLeadingMarpFrontmatter(markdown);
  return [
    "---",
    "marp: true",
    `theme: ${theme}`,
    `size: ${size}`,
    `paginate: ${paginate ? "true" : "false"}`,
    "---",
    bodyMarkdown,
  ].join("\n");
}

function createSlideDocument(
  html: string,
  css: string,
  slideIndex: number
): string {
  const safeSlideIndex = Math.max(0, slideIndex);
  const normalizedCss = normalizeLightDarkForLightMode(css);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  background: #ffffff;
}

body {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

${normalizedCss}

.marpit {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.marpit > svg {
  display: none !important;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
}

.marpit > svg:nth-of-type(${safeSlideIndex + 1}) {
  display: block !important;
}
</style>
</head>
<body>
${html}
</body>
</html>`;
}

export function MarpSlides({
  markdown,
  enabled,
  size,
  theme,
  paginate,
  slideIndex,
  onSlideIndexChange,
}: MarpSlidesProps) {
  const [asyncRenderState, setAsyncRenderState] = useState<SlideRenderState>({
    status: "loading",
  });

  const marpMarkdown = useMemo(
    () => createMarpMarkdown(markdown, theme, size, paginate),
    [markdown, paginate, size, theme]
  );
  const markdownByteLength = useMemo(
    () => getUtf8ByteLength(marpMarkdown),
    [marpMarkdown]
  );
  const preflightState = useMemo<SlideRenderState | null>(() => {
    if (!enabled) {
      return { status: "unavailable" };
    }

    if (markdown.trim().length === 0) {
      return { status: "empty" };
    }

    if (markdownByteLength > MARP_BODY_SIZE_LIMIT_BYTES) {
      return { status: "too-large" };
    }

    return null;
  }, [enabled, markdown, markdownByteLength]);

  const renderState = preflightState ?? asyncRenderState;

  useEffect(() => {
    if (preflightState) {
      return;
    }

    let canceled = false;
    const loadingTimerId = window.setTimeout(() => {
      if (!canceled) {
        setAsyncRenderState({ status: "loading" });
      }
    }, 0);

    const timerId = window.setTimeout(() => {
      void loadMarp()
        .then(({ Marp }) => {
          if (canceled) {
            return;
          }

          const marp = new Marp({
            html: false,
            minifyCSS: false,
            script: false,
          });
          const { html, css } = marp.render(marpMarkdown);
          const slideCount = getSlideCount(html);

          if (canceled) {
            return;
          }

          if (slideCount === 0) {
            setAsyncRenderState({ status: "empty" });
            return;
          }

          setAsyncRenderState({ status: "rendered", html, css, slideCount });
        })
        .catch((error: unknown) => {
          if (!canceled) {
            setAsyncRenderState({
              status: "error",
              message: getErrorMessage(error),
            });
          }
        });
    }, MARP_RENDER_DEBOUNCE_MS);

    return () => {
      canceled = true;
      window.clearTimeout(loadingTimerId);
      window.clearTimeout(timerId);
    };
  }, [marpMarkdown, preflightState]);

  useEffect(() => {
    if (renderState.status !== "rendered") {
      return;
    }

    const maxIndex = renderState.slideCount - 1;
    if (slideIndex > maxIndex) {
      onSlideIndexChange(maxIndex);
    } else if (slideIndex < 0) {
      onSlideIndexChange(0);
    }
  }, [onSlideIndexChange, renderState, slideIndex]);

  const canMoveBackward =
    renderState.status === "rendered" && slideIndex > 0;
  const canMoveForward =
    renderState.status === "rendered" &&
    slideIndex < renderState.slideCount - 1;

  const moveTo = (nextIndex: number) => {
    if (renderState.status !== "rendered") {
      return;
    }

    const clampedIndex = Math.min(
      Math.max(0, nextIndex),
      renderState.slideCount - 1
    );
    onSlideIndexChange(clampedIndex);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renderState.status !== "rendered") {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(slideIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(slideIndex + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(renderState.slideCount - 1);
    }
  };

  const frameDocument =
    renderState.status === "rendered"
      ? createSlideDocument(renderState.html, renderState.css, slideIndex)
      : "";

  return (
    <div className="slides-panel editor-body">
      <div
        className="slides-shell"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Slide preview"
      >
        <div className="slides-toolbar">
          {renderState.status === "rendered" ? (
            <div className="slides-controls" aria-label="Slide navigation">
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => moveTo(0)}
                disabled={!canMoveBackward}
              >
                First
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => moveTo(slideIndex - 1)}
                disabled={!canMoveBackward}
              >
                Previous
              </button>
              <div
                className="slide-count"
                aria-label={`Slide ${slideIndex + 1} of ${
                  renderState.slideCount
                }`}
              >
                {slideIndex + 1} / {renderState.slideCount}
              </div>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => moveTo(slideIndex + 1)}
                disabled={!canMoveForward}
              >
                Next
              </button>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => moveTo(renderState.slideCount - 1)}
                disabled={!canMoveForward}
              >
                Last
              </button>
            </div>
          ) : null}
        </div>

        {renderState.status === "rendered" ? (
          <div
            className="slides-viewport"
            style={{ aspectRatio: size === "4:3" ? "4 / 3" : "16 / 9" }}
          >
            <iframe
              className="slides-frame"
              title="Slide preview"
              sandbox=""
              srcDoc={frameDocument}
            />
          </div>
        ) : renderState.status === "loading" ? (
          <div className="slides-message">Rendering slides...</div>
        ) : renderState.status === "unavailable" ? (
          <div className="slides-message">
            <strong>Slides unavailable for this note.</strong>
            <span>Turn on Marp in the Slides settings above.</span>
          </div>
        ) : renderState.status === "too-large" ? (
          <div className="slides-message" role="alert">
            Slide deck is too large to render automatically.
          </div>
        ) : renderState.status === "empty" ? (
          <div className="slides-message">No slides to display.</div>
        ) : (
          <div className="slides-message error" role="alert">
            <strong>Unable to render slides.</strong>
            <span>{renderState.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
