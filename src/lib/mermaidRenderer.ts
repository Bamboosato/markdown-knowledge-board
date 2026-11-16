import { sanitizeSvg } from "./sanitizeSvg";

export const MERMAID_CODE_SIZE_LIMIT_BYTES = 50 * 1024;

type MermaidApi = typeof import("mermaid")["default"];
let mermaidPromise: Promise<MermaidApi> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => module.default);
  }
  return mermaidPromise;
}

export async function renderMermaidSvg(
  code: string,
  id: string,
  standalone = false,
  forPrint = false,
): Promise<string> {
  if (new TextEncoder().encode(code).length > MERMAID_CODE_SIZE_LIMIT_BYTES) {
    throw new Error("Diagram is too large to render automatically.");
  }
  // Mermaid configuration is global. Keep initialization and rendering together
  // so concurrent screen/print requests cannot use each other's layout settings.
  const pending = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "default",
      securityLevel: "strict",
      htmlLabels: false,
      // Reduce whitespace before scaling; preserve labels and diagram structure.
      ...(forPrint ? { flowchart: { nodeSpacing: 24, rankSpacing: 12, padding: 8 } } : {}),
    });
    const result = await mermaid.render(id, code);
    return sanitizeSvg(result.svg, standalone);
  });
  renderQueue = pending.catch(() => undefined);
  return pending;
}
