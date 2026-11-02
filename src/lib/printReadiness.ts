export type PrintReadiness =
  | { status: "ready" }
  | { status: "fallback"; reason: string }
  | { status: "failed" | "timeout"; reason: string };

export async function waitForPrintReadiness(
  element: HTMLElement,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<PrintReadiness> {
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const prepare = async (): Promise<PrintReadiness> => {
    try {
      await document.fonts?.ready;
    } catch {
      return { status: "failed", reason: "Fonts could not be loaded." };
    }
    if (stopped) return { status: "timeout", reason: "Print preparation timed out." };
    await new Promise<void>((resolve) => {
      const check = () => {
        if (stopped) return;
        if (!element.querySelector('[data-mermaid-status="loading"]')) return resolve();
        pollTimer = setTimeout(check, 50);
      };
      check();
    });
    const brokenDiagrams = Array.from(element.querySelectorAll('[data-mermaid-status="error"], [data-mermaid-status="too-large"], [data-print-fallback="oversized"]'));
    if (brokenDiagrams.some((diagram) => !diagram.querySelector("pre code"))) {
      return { status: "failed", reason: "A Mermaid diagram could not be rendered." };
    }
    try {
      await Promise.all(Array.from(element.querySelectorAll("img"), async (image) => {
        await image.decode();
        if (!image.naturalWidth) throw new Error("Invalid image");
      }));
    } catch {
      return { status: "failed", reason: "An image could not be decoded." };
    }
    return brokenDiagrams.length
      ? { status: "fallback", reason: "A Mermaid diagram is shown as source code." }
      : { status: "ready" };
  };
  try {
    return await Promise.race([
      prepare(),
      new Promise<PrintReadiness>((resolve) => {
        deadline = setTimeout(() => resolve({ status: "timeout", reason: "Print preparation timed out." }), timeoutMs);
      }),
      new Promise<PrintReadiness>((resolve) => {
        onAbort = () => resolve({ status: "failed", reason: "Print preparation was canceled." });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    stopped = true;
    clearTimeout(deadline);
    clearTimeout(pollTimer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
