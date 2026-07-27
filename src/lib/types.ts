export const MARP_THEMES = ["default", "gaia", "uncover"] as const;
export const MARP_SIZES = ["16:9", "4:3"] as const;
export const MARP_HEADING_DIVIDERS = [1, 2, 3, 4, 5, 6] as const;

export type MarpTheme = (typeof MARP_THEMES)[number];
export type MarpSize = (typeof MARP_SIZES)[number];
export type MarpHeadingDivider = (typeof MARP_HEADING_DIVIDERS)[number];

export type MarpSettings = {
  enabled: boolean;
  theme: MarpTheme;
  size: MarpSize;
  paginate: boolean;
  headingDivider: MarpHeadingDivider | false;
};

export const DEFAULT_MARP_SETTINGS: MarpSettings = {
  enabled: false,
  theme: "default",
  size: "16:9",
  paginate: true,
  headingDivider: false,
};

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  marp?: MarpSettings;
};

export function getNoteMarpSettings(note?: Pick<Note, "marp">): MarpSettings {
  return {
    ...DEFAULT_MARP_SETTINGS,
    ...(note?.marp ?? {}),
  };
}
