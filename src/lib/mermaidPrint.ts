// A4 is about 794 CSS px wide. Using 800 as the maximum rendered width
// overestimates both print regions; 800 px in height also reserves margin
// for the warning and surrounding content. Oversized SVGs do not fragment
// reliably in browser print layout.
export function requiresMermaidPrintFallback(svg: string): boolean {
  const match = /<svg\b[^>]*\bviewBox\s*=\s*["']\s*[-+\d.eE]+[\s,]+[-+\d.eE]+[\s,]+([-+\d.eE]+)[\s,]+([-+\d.eE]+)\s*["']/i.exec(svg);
  if (!match) return true;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return true;
  const svgTag = /^\s*<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const maxWidth = /\bmax-width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(svgTag);
  const declaredLimit = maxWidth ? Number(maxWidth[1]) : 800;
  const estimatedWidth = Number.isFinite(declaredLimit) && declaredLimit > 0 ? Math.min(800, declaredLimit) : 800;
  return height * estimatedWidth / width > 800;
}
