// PDF-02 covers elements taller than two printable A4 pages. Smaller images
// retain the browser's existing layout, including ordinary portrait photos.
export const PRINT_IMAGE_MAX_HEIGHT = Math.floor((297 - 2 * 18) * 96 / 25.4) * 2;
const SLICE_HEIGHT = 720;
// A shorter leading piece can share the page with the document heading.
const FIRST_SLICE_HEIGHT = 240;
const PRINT_WIDTH = (210 - 2 * 16) * 96 / 25.4;
const MAX_SLICES = 100;
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_EDGE = 8192;
const MAX_DOCUMENT_PIXELS = 32_000_000;

export function planPrintImageSlices(width: number, height: number, printWidth = width) {
  if (!(width > 0 && height > 0 && printWidth > 0) || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(printWidth)) return null;
  const printHeight = height * printWidth / width;
  if (printHeight <= PRINT_IMAGE_MAX_HEIGHT) return null;
  const scale = printWidth / width;
  const sourceSliceHeight = Math.max(1, Math.floor(SLICE_HEIGHT / scale));
  const firstSourceHeight = Math.min(height, Math.max(1, Math.floor(FIRST_SLICE_HEIGHT / scale)));
  const count = 1 + Math.ceil((height - firstSourceHeight) / sourceSliceHeight);
  if (count > MAX_SLICES) throw new Error("Image is too tall to prepare for printing.");
  return { width: printWidth, height: printHeight, slices: Array.from({ length: count }, (_, i) => {
    const sourceOffset = i === 0 ? 0 : firstSourceHeight + (i - 1) * sourceSliceHeight;
    const sourceHeight = i === 0 ? firstSourceHeight : Math.min(sourceSliceHeight, height - sourceOffset);
    return { offset: sourceOffset * scale, height: sourceHeight * scale, sourceOffset, sourceHeight };
  }) };
}

export function planPrintDocumentImages(images: ReadonlyArray<{ width: number; height: number; printWidth?: number }>) {
  let totalPixels = 0;
  let totalSlices = 0;
  return images.map(({ width, height, printWidth }) => {
    const plan = planPrintImageSlices(width, height, printWidth);
    if (!plan) return null;
    totalPixels += width * height;
    totalSlices += plan.slices.length;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > MAX_DOCUMENT_PIXELS || totalSlices > MAX_SLICES) {
      throw new Error("Images exceed the safe total print preparation limit.");
    }
    if (width > MAX_CANVAS_EDGE || plan.slices.some((s) => s.sourceHeight > MAX_CANVAS_EDGE || width * s.sourceHeight > MAX_CANVAS_PIXELS)) {
      throw new Error("Image dimensions exceed the safe print preparation limit.");
    }
    return plan;
  });
}

// Measure the same print rules and available A4 width synchronously before
// printing. The temporary styles are removed before the browser can paint.
export function measurePrintImageWidths(surface: HTMLElement, images: HTMLImageElement[]): number[] {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type === CSSRule.MEDIA_RULE && /\bprint\b/i.test((rule as CSSMediaRule).conditionText)) {
          for (const child of Array.from((rule as CSSMediaRule).cssRules)) rules.push(child.cssText);
        }
      }
    } catch {
      // Cross-origin sheets are not app print styles and cannot be inspected.
    }
  }
  if (!rules.length) throw new Error("Unable to measure print layout.");
  const temporary = document.createElement("style");
  temporary.textContent = rules.join("\n");
  const previous = surface.style.cssText;
  try {
    document.body.appendChild(temporary);
    for (const [property, value] of Object.entries({ display: "block", position: "fixed", visibility: "hidden", width: `${PRINT_WIDTH}px`, "max-width": "none", height: "auto", left: "0", top: "0" })) {
      surface.style.setProperty(property, value, "important");
    }
    return images.map((image) => {
      const width = image.getBoundingClientRect().width;
      if (!(width > 0) || !Number.isFinite(width)) throw new Error("Unable to measure an image in print layout.");
      return width;
    });
  } finally {
    surface.style.cssText = previous;
    temporary.remove();
  }
}

// Temporary siblings preserve the original image and are removed after print.
export function createPrintImageSlices(surface: HTMLElement, measure = measurePrintImageWidths): () => void {
  const created: Array<{ original: HTMLImageElement; container: HTMLElement }> = [];
  const canvases: HTMLCanvasElement[] = [];
  const cleanup = () => {
    for (const { original, container } of created) {
      original.classList.remove("print-image-source");
      container.remove();
    }
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
  };
  try {
    const images = Array.from(surface.querySelectorAll("img"));
    const widths = images.length ? measure(surface, images) : [];
    const plans = planPrintDocumentImages(images.map((image, index) => ({ width: image.naturalWidth, height: image.naturalHeight, printWidth: widths[index] })));
    for (const [index, image] of images.entries()) {
      const plan = plans[index];
      if (!plan) continue;
      const container = document.createElement("span");
      container.className = "print-image-slices";
      container.setAttribute("aria-hidden", "true");
      for (const slice of plan.slices) {
        const frame = document.createElement("span");
        frame.className = "print-image-slice";
        frame.style.width = `${plan.width}px`;
        frame.style.aspectRatio = `${plan.width} / ${slice.height}`;
        const canvas = document.createElement("canvas");
        canvases.push(canvas);
        canvas.width = image.naturalWidth;
        canvas.height = slice.sourceHeight;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to prepare image for printing.");
        context.drawImage(image, 0, slice.sourceOffset, image.naturalWidth, slice.sourceHeight, 0, 0, image.naturalWidth, slice.sourceHeight);
        frame.appendChild(canvas);
        container.appendChild(frame);
      }
      created.push({ original: image, container });
      image.classList.add("print-image-source");
      image.insertAdjacentElement("afterend", container);
    }
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
