import type { CSSProperties } from "react";
import type { StyledExportOptions } from "./types";

type StyleVariables = CSSProperties & Record<`--${string}`, string>;

export function getThemeVariables(options: StyledExportOptions): StyleVariables {
  const palettes: Record<string, [string, string, string, string]> = {
    slate: ["#334155", "#f1f5f9", "#0f172a", "#ffffff"], ocean: ["#0369a1", "#e0f2fe", "#082f49", "#ffffff"],
    forest: ["#166534", "#dcfce7", "#052e16", "#ffffff"], plum: ["#7e22ce", "#f3e8ff", "#3b0764", "#ffffff"],
    amber: ["#b45309", "#fef3c7", "#451a03", "#ffffff"], "fresh-lime": ["#4d7c0f", "#ecfccb", "#1a2e05", "#ffffff"],
    monochrome: ["#404040", "#f5f5f5", "#171717", "#ffffff"], graphite: ["#52525b", "#e4e4e7", "#18181b", "#ffffff"],
    sage: ["#4d6b57", "#e7eee8", "#26382c", "#ffffff"], sand: ["#8a6742", "#f5ede2", "#463522", "#ffffff"],
    sakura: ["#be185d", "#fce7f3", "#500724", "#ffffff"], "powder-blue": ["#2563a6", "#e8f2fc", "#122e4b", "#ffffff"],
    mint: ["#0f766e", "#ccfbf1", "#042f2e", "#ffffff"], lavender: ["#6d5aa6", "#ede9fe", "#2e1065", "#ffffff"],
    apricot: ["#c2410c", "#ffedd5", "#431407", "#ffffff"], midnight: ["#60a5fa", "#1e293b", "#f8fafc", "#0f172a"],
    burgundy: ["#fda4af", "#4c0519", "#fff1f2", "#19040a"], night: ["#a78bfa", "#18181b", "#fafafa", "#09090b"],
    "noir-gold": ["#d4af37", "#27272a", "#fafafa", "#171717"], "onyx-mint": ["#5eead4", "#1f2937", "#f9fafb", "#111827"],
    "onyx-red": ["#f87171", "#27272a", "#fafafa", "#111111"],
  };
  const samplePalettes: Record<string, Record<string, string>> = {
    slate: { canvas: "#eef1f5", accent: "#3a6ea5", soft: "#e9f0f8", text: "#26303b", page: "#fff", muted: "#647082", rule: "#e3e8ef", accentInk: "#2a527c", header: "linear-gradient(135deg,#2f4a6b 0%,#3a6ea5 100%)", tableHead: "#2f4a6b", tableStripe: "#f5f8fc" },
    burgundy: { canvas: "#f4edee", accent: "#8a3a4d", soft: "#f2e3e7", text: "#2d232a", page: "#fff", muted: "#6e5d64", rule: "#e9dbde", accentInk: "#6d2c3c", header: "linear-gradient(135deg,#57202d 0%,#8a3a4d 100%)", tableHead: "#57202d", tableStripe: "#f7eff1" },
    "onyx-mint": { canvas: "#ededed", accent: "#b2e1d6", soft: "#e3f2ef", text: "#303030", page: "#fff", muted: "#6e6e6e", rule: "#e0e0e0", accentInk: "#141414", header: "linear-gradient(135deg,#101010 0%,#1a1a1a 100%)", tableHead: "#b5b5b5", tableHeadInk: "#303030", tableStripe: "#f4f4f4" },
  };
  const designs: Record<string, Record<string, string>> = {
    comfort: { baseSize: "15px", lineHeight: "1.85", contentGap: "22px", letterSpacing: ".01em", pageRadius: "14px", pageShadow: "0 1px 2px rgba(20,40,80,.05),0 10px 30px rgba(20,40,80,.07)", pageWidth: "960px", bodyPadY: "10mm", bodyPadX: "12mm", headerPadY: "40px", headerPadX: "12mm", titleSize: "1.8em", headingSize: "1.3em", headingBarWidth: "8px", headingPadY: "5px", headingPadX: "12px", headingGap: "22px", headingBg: "transparent" },
    compact: { baseSize: "13.5px", lineHeight: "1.6", contentGap: "13px", letterSpacing: "0", pageRadius: "6px", pageShadow: "none", pageWidth: "960px", bodyPadY: "10mm", bodyPadX: "12mm", headerPadY: "12px", headerPadX: "12mm", titleSize: "1.2em", headingSize: "1.18em", headingBarWidth: "8px", headingPadY: "4px", headingPadX: "12px", headingGap: "13px", headingBg: "transparent" },
    technical: { baseSize: "16px", lineHeight: "1.7", contentGap: "20px", letterSpacing: ".02em", pageRadius: "6px", pageShadow: "none", pageWidth: "960px", bodyPadY: "10mm", bodyPadX: "12mm", headerPadY: "38px", headerPadX: "12mm", titleSize: "1.8em", headingSize: "1.45em", headingBarWidth: "10px", headingPadY: "9px", headingPadX: "14px", headingGap: "20px", headingBg: "repeating-linear-gradient(-45deg,var(--styled-soft),var(--styled-soft) 10px,var(--styled-page) 10px,var(--styled-page) 15px)" },
    formal: { baseSize: "14.5px", lineHeight: "1.7", contentGap: "16px", letterSpacing: ".01em", pageRadius: "0", pageShadow: "none", pageWidth: "960px", bodyPadY: "10mm", bodyPadX: "12mm", headerPadY: "34px", headerPadX: "12mm", titleSize: "1.8em", headingSize: "1.3em", headingBarWidth: "7px", headingPadY: "4px", headingPadX: "12px", headingGap: "16px", headingBg: "transparent" },
    editorial: { baseSize: "16px", lineHeight: "1.8", contentGap: "24px", letterSpacing: ".01em", pageRadius: "8px", pageShadow: "0 8px 28px rgba(15,23,42,.08)", pageWidth: "960px", bodyPadY: "12mm", bodyPadX: "13mm", headerPadY: "44px", headerPadX: "13mm", titleSize: "2.3em", headingSize: "1.45em", headingBarWidth: "0", headingPadY: "5px", headingPadX: "12px", headingGap: "24px", headingBg: "transparent" },
    soft: { baseSize: "15px", lineHeight: "1.75", contentGap: "20px", letterSpacing: ".01em", pageRadius: "18px", pageShadow: "0 8px 28px rgba(15,23,42,.08)", pageWidth: "960px", bodyPadY: "11mm", bodyPadX: "12mm", headerPadY: "38px", headerPadX: "12mm", titleSize: "1.8em", headingSize: "1.3em", headingBarWidth: "6px", headingPadY: "6px", headingPadX: "12px", headingGap: "20px", headingBg: "color-mix(in srgb,var(--styled-soft) 45%,var(--styled-page))" },
    form: { baseSize: "14px", lineHeight: "1.6", contentGap: "14px", letterSpacing: "0", pageRadius: "4px", pageShadow: "none", pageWidth: "960px", bodyPadY: "9mm", bodyPadX: "11mm", headerPadY: "28px", headerPadX: "11mm", titleSize: "1.7em", headingSize: "1.2em", headingBarWidth: "4px", headingPadY: "4px", headingPadX: "10px", headingGap: "14px", headingBg: "transparent" },
    website: { baseSize: "16px", lineHeight: "1.75", contentGap: "22px", letterSpacing: ".01em", pageRadius: "12px", pageShadow: "0 8px 28px rgba(15,23,42,.08)", pageWidth: "1040px", bodyPadY: "12mm", bodyPadX: "9vw", headerPadY: "48px", headerPadX: "9vw", titleSize: "2em", headingSize: "1.35em", headingBarWidth: "0", headingPadY: "5px", headingPadX: "12px", headingGap: "22px", headingBg: "transparent" },
  };
  const [accent, soft, text, page] = palettes[options.colorId];
  const palette = samplePalettes[options.colorId] ?? {};
  const sampleDesigns: Record<string, Record<string, string>> = {
    soft: {
      baseSize: "15px", lineHeight: "1.95", letterSpacing: ".02em",
      pageRadius: "22px", pageShadow: "0 6px 22px rgba(20,40,80,.08)",
      titleSize: "1.872em", headingSize: "1.612em", headingBarWidth: "8px",
      headingBg: "transparent", headingFont: '"Hiragino Maru Gothic ProN","Yu Gothic","Meiryo",sans-serif',
    },
    form: {
      baseSize: "14px", lineHeight: "1.6", letterSpacing: ".01em",
      contentGap: "15px", pageRadius: "3px", pageShadow: "none",
      bodyPadY: "10mm", bodyPadX: "12mm", titleSize: "1.8em",
      headingSize: "1.55em", headingBarWidth: "8px", headingBg: "transparent",
    },
    editorial: {
      baseSize: "15.5px", lineHeight: "1.95", letterSpacing: ".02em",
      pageRadius: "4px", pageShadow: "none", titleSize: "2.16em",
      headingSize: "1.86em", headingBarWidth: "8px",
      headingFont: '"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP",serif',
    },
    website: {
      baseSize: "16px", lineHeight: "1.9", contentGap: "22px",
      pageRadius: "12px", pageShadow: "0 1px 2px rgba(20,40,80,.04),0 14px 40px rgba(20,40,80,.08)",
      pageWidth: "960px", bodyPadY: "10mm", bodyPadX: "12mm",
      headerPadY: "48px", headerPadX: "12mm", titleSize: "2.2em",
      headingSize: "2.1em", headingBarWidth: "8px", headingGap: "36px",
      headingWeight: "800",
    },
  };
  const design = { ...designs[options.designId], ...sampleDesigns[options.designId] };
  const resolvedAccent = palette.accent ?? accent;
  const resolvedSoft = palette.soft ?? soft;
  const resolvedText = palette.text ?? text;
  const darkAccent = `color-mix(in srgb, ${resolvedAccent} 52%, #142033)`;
  return {
    "--styled-canvas": palette.canvas ?? `color-mix(in srgb, ${resolvedSoft} 28%, #eef1f5)`,
    "--styled-accent": resolvedAccent, "--styled-accent-ink": palette.accentInk ?? resolvedText,
    "--styled-soft": resolvedSoft, "--styled-text": resolvedText, "--styled-muted": palette.muted ?? "#647082",
    "--styled-rule": palette.rule ?? "#d5dce5", "--styled-page": palette.page ?? page,
    "--styled-header-bg": palette.header ?? `linear-gradient(135deg,${darkAccent} 0%,${resolvedAccent} 100%)`,
    "--styled-header-ink": palette.headerInk ?? "#ffffff", "--styled-table-head-bg": palette.tableHead ?? darkAccent,
    "--styled-table-head-ink": palette.tableHeadInk ?? "#ffffff", "--styled-table-stripe": palette.tableStripe ?? resolvedSoft,
    "--styled-scale": String(options.textScale / 100), "--styled-base-size": design.baseSize,
    "--styled-line-height": design.lineHeight, "--styled-content-gap": design.contentGap,
    "--styled-letter-spacing": design.letterSpacing, "--styled-page-radius": design.pageRadius,
    "--styled-page-shadow": design.pageShadow, "--styled-page-width": design.pageWidth,
    "--styled-body-pad-y": design.bodyPadY, "--styled-body-pad-x": design.bodyPadX,
    "--styled-header-pad-y": design.headerPadY, "--styled-header-pad-x": design.headerPadX,
    "--styled-title-size": design.titleSize, "--styled-heading-size": design.headingSize,
    "--styled-heading-font": design.headingFont ?? "inherit",
    "--styled-heading-weight": design.headingWeight ?? "700",
    "--styled-heading-bar-width": design.headingBarWidth, "--styled-heading-pad-y": design.headingPadY,
    "--styled-heading-pad-x": design.headingPadX, "--styled-heading-gap": design.headingGap,
    "--styled-heading-bg": design.headingBg,
  };
}
