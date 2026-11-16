import { DEFAULT_PRINT_LAYOUT, getPrintGeometry } from "./styledExport/printLayout";

// Reserve margins and room for a nearby heading, not the remainder of a page.
// CSS break-inside: avoid moves the complete diagram to the next page when needed.
const PRINT_DIAGRAM_SPACING = 96;

export function getMermaidPrintLayout(svg: string, geometry = getPrintGeometry(DEFAULT_PRINT_LAYOUT, "app")) {
  const match = /<svg\b[^>]*\bviewBox\s*=\s*["']\s*[-+\d.eE]+[\s,]+[-+\d.eE]+[\s,]+([-+\d.eE]+)[\s,]+([-+\d.eE]+)\s*["']/i.exec(svg);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (![width, height, geometry.width, geometry.height].every((value) => Number.isFinite(value) && value > 0)) return null;
  const availableHeight = geometry.height - PRINT_DIAGRAM_SPACING;
  if (availableHeight <= 0) return null;
  const svgTag = /^\s*<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const maxWidth = /\bmax-width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(svgTag);
  const naturalWidth = maxWidth && Number(maxWidth[1]) > 0 ? Math.min(width, Number(maxWidth[1])) : width;
  const scale = Math.min(naturalWidth / width, geometry.width / width, availableHeight / height);
  return {
    width: width * scale,
    height: height * scale,
    scale,
    // Advisory only: a typical 16px label falls below 9pt at this scale.
    smallText: scale < 0.75,
  };
}
