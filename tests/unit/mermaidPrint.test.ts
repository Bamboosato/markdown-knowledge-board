import { describe, expect, it } from "vitest";
import { getMermaidPrintLayout } from "../../src/lib/mermaidPrint";

describe("Mermaid print size", () => {
  it("fits both page dimensions without upscaling or changing aspect ratio", () => {
    for (const [width, height] of [[100, 200], [1200, 1200], [1200, 1800], [200, 6000]]) {
      const fit = getMermaidPrintLayout(`<svg viewBox="-10 -20 ${width} ${height}"></svg>`, { width: 600, height: 900 })!;
      expect(fit.width).toBeLessThanOrEqual(600);
      expect(fit.height).toBeLessThan(900);
      expect(fit.width / fit.height).toBeCloseTo(width / height);
      expect(fit.scale).toBeLessThanOrEqual(1);
    }
    expect(getMermaidPrintLayout('<svg viewBox="0 0 100 200"></svg>')?.scale).toBe(1);
    expect(getMermaidPrintLayout('<svg viewBox="0 0 1200 1800"></svg>')?.smallText).toBe(true);
  });
  it("respects a declared smaller natural size", () => {
    expect(getMermaidPrintLayout('<svg viewBox="0 0 600 800" style="max-width: 300px"></svg>')?.width).toBe(300);
  });
  it("uses the safe source fallback for malformed and unknown dimensions", () => {
    expect(getMermaidPrintLayout('<svg viewBox="0 0 0 9999"></svg>')).toBeNull();
    expect(getMermaidPrintLayout('<svg></svg>')).toBeNull();
    expect(getMermaidPrintLayout('<svg viewBox="0 0 100 100"></svg>', { width: 0, height: 900 })).toBeNull();
  });
});
