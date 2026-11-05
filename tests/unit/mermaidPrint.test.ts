import { describe, expect, it } from "vitest";
import { requiresMermaidPrintFallback } from "../../src/lib/mermaidPrint";

describe("Mermaid print size", () => {
  it("uses source only above the available page-height boundary", () => {
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 600 800" style="max-width: 600px"></svg>')).toBe(false);
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 600 801" style="max-width: 600px"></svg>')).toBe(true);
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 600 800"></svg>')).toBe(true);
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 1200 1200"></svg>')).toBe(false);
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 1200 1201"></svg>')).toBe(true);
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 1200 1800"></svg>')).toBe(true);
  });
  it("uses the safe source fallback for malformed and unknown dimensions", () => {
    expect(requiresMermaidPrintFallback('<svg viewBox="0 0 0 9999"></svg>')).toBe(true);
    expect(requiresMermaidPrintFallback('<svg></svg>')).toBe(true);
  });
});
