export const STYLED_EXPORT_COLORS = [
  { id: "slate", label: "Slate" },
  { id: "ocean", label: "Ocean" },
  { id: "forest", label: "Forest" },
  { id: "plum", label: "Plum" },
  { id: "amber", label: "Amber" },
  { id: "fresh-lime", label: "Fresh Lime" },
  { id: "monochrome", label: "Monochrome" },
  { id: "graphite", label: "Graphite" },
  { id: "sage", label: "Sage" },
  { id: "sand", label: "Sand" },
  { id: "sakura", label: "Sakura" },
  { id: "powder-blue", label: "Powder Blue" },
  { id: "mint", label: "Mint" },
  { id: "lavender", label: "Lavender" },
  { id: "apricot", label: "Apricot" },
  { id: "midnight", label: "Midnight" },
  { id: "burgundy", label: "Burgundy" },
  { id: "night", label: "Night" },
  { id: "noir-gold", label: "Noir & Gold" },
  { id: "onyx-mint", label: "Onyx Mint" },
  { id: "onyx-red", label: "Onyx Red" },
] as const;

export const STYLED_EXPORT_DESIGNS = [
  { id: "comfort", label: "Comfort" },
  { id: "compact", label: "Compact" },
  { id: "editorial", label: "Editorial" },
  { id: "formal", label: "Formal" },
  { id: "soft", label: "Soft" },
  { id: "technical", label: "Technical" },
  { id: "form", label: "Form" },
  { id: "website", label: "Website" },
] as const;

export const STYLED_EXPORT_TEXT_SCALES = [
  80, 85, 90, 95, 100, 105, 110, 115, 120, 130, 150,
] as const;

export type StyledExportColorId =
  (typeof STYLED_EXPORT_COLORS)[number]["id"];
export type StyledExportDesignId =
  (typeof STYLED_EXPORT_DESIGNS)[number]["id"];
export type StyledExportTextScale =
  (typeof STYLED_EXPORT_TEXT_SCALES)[number];

export type StyledExportOptions = {
  colorId: StyledExportColorId;
  designId: StyledExportDesignId;
  textScale: StyledExportTextScale;
  showTags: boolean;
};

export type MarkdownPosition = {
  line: number;
  column: number;
};

export type StyledExportIssue = {
  id: string;
  kind: "image" | "local-link" | "unsafe-link" | "mermaid";
  reference: string;
  position: MarkdownPosition;
  reason: string;
};

export type StyledImageReference = {
  id: string;
  url: string;
  position: MarkdownPosition;
};

export type StyledLinkReference = {
  id: string;
  url: string;
  position: MarkdownPosition;
  kind: "local" | "unsafe";
};

export type StyledMarkdownAnalysis = {
  images: StyledImageReference[];
  links: StyledLinkReference[];
  mermaidCodes: string[];
  firstH1Text: string;
  firstH1Line: number | null;
  headingIds: Map<number, string>;
  headingIdBySlug: Map<string, string>;
  issues: StyledExportIssue[];
};

export type StyledAssetMap = Record<string, string>;

export const DEFAULT_STYLED_EXPORT_OPTIONS: StyledExportOptions = {
  colorId: "slate",
  designId: "comfort",
  textScale: 100,
  showTags: false,
};
