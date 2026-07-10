export const MARP_THEMES = ["default", "gaia", "uncover"] as const;
export const MARP_SIZES = ["16:9", "4:3"] as const;

export type MarpTheme = (typeof MARP_THEMES)[number];
export type MarpSize = (typeof MARP_SIZES)[number];

export type MarpSettings = {
  enabled: boolean;
  theme: MarpTheme;
  size: MarpSize;
  paginate: boolean;
};

export const DEFAULT_MARP_SETTINGS: MarpSettings = {
  enabled: false,
  theme: "default",
  size: "16:9",
  paginate: true,
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
