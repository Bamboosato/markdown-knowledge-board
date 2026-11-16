import { describe, expect, it } from "vitest";
import { getPrintGeometry, printPageCss } from "../../src/lib/styledExport/printLayout";
import type { Orientation, PaperSize } from "../../src/lib/styledExport/printLayout";
import { planPrintImageSlices } from "../../src/lib/printImageSlices";
import { getMermaidPrintLayout } from "../../src/lib/mermaidPrint";

describe("Styled print layout", () => {
  it.each([
    ["a4", "portrait", 210, 297], ["a4", "landscape", 297, 210],
    ["letter", "portrait", 215.9, 279.4], ["letter", "landscape", 279.4, 215.9],
  ] as const)("uses the selected %s %s size and each output's existing margins", (paperSize, orientation, width, height) => {
    const layout = { paperSize: paperSize as PaperSize, orientation: orientation as Orientation };
    for (const [target, margin] of [["app", 16], ["html", 14]] as const) {
      const geometry = getPrintGeometry(layout, target);
      expect(geometry.width).toBeCloseTo((width - margin * 2) * 96 / 25.4);
      expect(geometry.height).toBeCloseTo((height - 36) * 96 / 25.4);
      expect(printPageCss(layout, target, "Title")).toContain(`margin:18mm ${margin}mm`);
      expect(printPageCss(layout, target, "Title")).toContain(`size:${paperSize === "a4" ? "A4" : "letter"} ${orientation}`);
    }
  });

  it("fits tall image pieces to the shorter landscape page", () => {
    const page = getPrintGeometry({ paperSize: "a4", orientation: "landscape" }, "app");
    expect(planPrintImageSlices(100, 1500, 100, page.height)?.slices.every((slice) => slice.height <= page.height - 80)).toBe(true);
    expect(planPrintImageSlices(100, Math.floor(page.height) * 2, 100, page.height)).toBeNull();
  });

  it("fits a diagram to the shorter landscape page and escapes a title", () => {
    const svg = '<svg viewBox="0 0 800 700"></svg>';
    const portrait = getMermaidPrintLayout(svg)!;
    const landscape = getMermaidPrintLayout(svg, getPrintGeometry({ paperSize: "a4", orientation: "landscape" }, "app"))!;
    expect(landscape.height).toBeLessThan(portrait.height);
    expect(landscape.width / landscape.height).toBeCloseTo(800 / 700);
    expect(printPageCss({ paperSize: "a4", orientation: "portrait" }, "html", '</style>')).not.toContain('</style>');
  });
});
