import { sanitizeSvg } from "./sanitizeSvg";

export const MERMAID_CODE_SIZE_LIMIT_BYTES = 50 * 1024;

type MermaidApi = typeof import("mermaid")["default"];
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "strict",
        htmlLabels: false,
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export async function renderMermaidSvg(
  code: string,
  id: string,
  standalone = false
): Promise<string> {
  if (new TextEncoder().encode(code).length > MERMAID_CODE_SIZE_LIMIT_BYTES) {
    throw new Error("Diagram is too large to render automatically.");
  }
  const mermaid = await loadMermaid();
  const result = await mermaid.render(id, code);
  return sanitizeSvg(result.svg, standalone);
}
