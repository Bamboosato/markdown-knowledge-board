import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrintImageSlices, planPrintDocumentImages, planPrintImageSlices } from "../../src/lib/printImageSlices";

afterEach(() => vi.unstubAllGlobals());

describe("print image slicing", () => {
  it("keeps the threshold and smaller images unchanged", () => {
    expect(planPrintImageSlices(100, 1971)).toBeNull();
    expect(planPrintImageSlices(100, 1972)).toBeNull();
    expect(planPrintImageSlices(100, 1973)?.slices).toEqual([{ offset: 0, height: 720, sourceOffset: 0, sourceHeight: 720 }, { offset: 720, height: 720, sourceOffset: 720, sourceHeight: 720 }, { offset: 1440, height: 533, sourceOffset: 1440, sourceHeight: 533 }]);
    expect(planPrintImageSlices(2000, 3000, 673)).toBeNull();
    expect(planPrintImageSlices(1000, 6000, 300)).toBeNull();
  });
  it("preserves proportional dimensions with contiguous non-overlapping slices", () => {
    const plan = planPrintImageSlices(1200, 6000, 600)!;
    expect(plan.width).toBe(600);
    expect(plan.height).toBe(3000);
    expect(plan.slices.map((s) => s.offset)).toEqual([0, 720, 1440, 2160, 2880]);
    expect(plan.slices.reduce((sum, s) => sum + s.height, 0)).toBe(3000);
  });
  it("bounds the number of generated pieces", () => {
    expect(() => planPrintImageSlices(100, 72001)).toThrow();
  });
  it("checks cumulative image memory and count before allocation", () => {
    const image = { width: 2000, height: 8000 };
    expect(planPrintDocumentImages([image, image])).toHaveLength(2);
    expect(() => planPrintDocumentImages([image, image, { width: 1, height: 1973 }])).toThrow(/total/);
    expect(() => planPrintDocumentImages([image, image, image])).toThrow(/total/);
    expect(() => planPrintDocumentImages([{ width: 3000, height: 300000, printWidth: 600 }])).toThrow(/total/);
    const small = { width: 100, height: 1973 };
    expect(planPrintDocumentImages(Array.from({ length: 33 }, () => small))).toHaveLength(33);
    expect(() => planPrintDocumentImages(Array.from({ length: 34 }, () => small))).toThrow(/total/);
  });
  it("releases all allocated canvases and restores prior images after a drawing failure", () => {
    const canvases: Array<{ width: number; height: number; style: object; getContext: () => object }> = [];
    const removed = vi.fn();
    let draws = 0;
    vi.stubGlobal("document", { createElement: (tag: string) => {
      if (tag === "canvas") {
        const canvas = { width: 0, height: 0, style: {}, getContext: () => ({ drawImage: () => { if (++draws === 4) throw new Error("draw failed"); } }) };
        canvases.push(canvas);
        return canvas;
      }
      return { className: "", style: {}, setAttribute: vi.fn(), appendChild: vi.fn(), remove: removed };
    } });
    const image = () => ({ naturalWidth: 100, naturalHeight: 1973, classList: { add: vi.fn(), remove: vi.fn() }, insertAdjacentElement: vi.fn() });
    const first = image();
    const surface = { querySelectorAll: () => [first, image()] } as unknown as HTMLElement;
    expect(() => createPrintImageSlices(surface, () => [100, 100])).toThrow("draw failed");
    expect(first.classList.remove).toHaveBeenCalledWith("print-image-source");
    expect(removed).toHaveBeenCalled();
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });
});
