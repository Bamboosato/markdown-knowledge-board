import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForPrintReadiness } from "../../src/lib/printReadiness";

// Normal, failed, boundary and state-transition cases exercise the print gate
// without depending on browser font or image loading timing.
function surface(options: { loading?: boolean; broken?: boolean; fallback?: boolean; image?: Partial<HTMLImageElement> } = {}) {
  return {
    querySelector: (selector: string) => {
      if (selector.includes("loading")) return options.loading ? {} : null;
      if (selector.includes("error") && options.broken) return { querySelector: () => options.fallback ? {} : null };
      return null;
    },
    querySelectorAll: (selector: string) => selector === "img" ? (options.image ? [options.image] : []) : (options.broken ? [{ querySelector: () => options.fallback ? {} : null }] : []),
  } as unknown as HTMLElement;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("print readiness", () => {
  it("accepts ready content and decoded images", async () => {
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
    expect(await waitForPrintReadiness(surface({ image: { decode: async () => {}, naturalWidth: 10 } }))).toEqual({ status: "ready" });
  });

  it("rejects broken images and unrendered diagrams without a code fallback", async () => {
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
    expect((await waitForPrintReadiness(surface({ image: { decode: async () => { throw new Error(); } } }))).status).toBe("failed");
    expect((await waitForPrintReadiness(surface({ broken: true }))).status).toBe("failed");
    expect((await waitForPrintReadiness(surface({ broken: true, fallback: true }))).status).toBe("fallback");
  });

  it("times out when fonts or Mermaid never complete", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { fonts: { ready: new Promise(() => {}) } });
    const fonts = waitForPrintReadiness(surface(), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect((await fonts).status).toBe("timeout");
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
    const diagram = waitForPrintReadiness(surface({ loading: true }), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect((await diagram).status).toBe("timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a pending attempt immediately when canceled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { fonts: { ready: new Promise(() => {}) } });
    const controller = new AbortController();
    const pending = waitForPrintReadiness(surface(), 10_000, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: "failed", reason: "Print preparation was canceled." });
    expect(vi.getTimerCount()).toBe(0);
  });
});
