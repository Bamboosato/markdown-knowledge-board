export type PaperSize = "a4" | "letter";
export type Orientation = "portrait" | "landscape";
export type PrintLayout = { paperSize: PaperSize; orientation: Orientation };

export const DEFAULT_PRINT_LAYOUT: PrintLayout = { paperSize: "a4", orientation: "portrait" };

export function getPrintGeometry(layout: PrintLayout, target: "app" | "html") {
  const [short, long] = layout.paperSize === "letter" ? [215.9, 279.4] : [210, 297];
  const [width, height] = layout.orientation === "landscape" ? [long, short] : [short, long];
  const marginX = target === "app" ? 16 : 14;
  return { width: (width - marginX * 2) * 96 / 25.4, height: (height - 36) * 96 / 25.4 };
}

function cssString(value: string) {
  return `"${Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    return character === "\\" || character === '"' || code < 0x20 || code === 0x7f || character === "<"
      ? `\\${code.toString(16)} ` : character;
  }).join("")}"`;
}

export function printPageCss(layout: PrintLayout, target: "app" | "html", title: string) {
  const size = layout.paperSize === "letter" ? "letter" : "A4";
  const orientation = layout.orientation === "landscape" ? "landscape" : "portrait";
  const margin = target === "app" ? "18mm 16mm" : "18mm 14mm";
  return `@page{size:${size} ${orientation};margin:${margin};@top-center{content:${cssString(title)}}@bottom-right{content:counter(page) " / " counter(pages)}}`;
}
