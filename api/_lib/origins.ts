export const ORIGIN_CONFIG = {
  primary: {
    key: 'primary',
    origin: 'https://mkb.bamboosato.com',
    callbackUrl: 'https://mkb.bamboosato.com/api/auth/github/callback',
  },
  vercel: {
    key: 'vercel',
    origin: 'https://markdown-knowledge-board.vercel.app',
    callbackUrl:
      'https://markdown-knowledge-board.vercel.app/api/auth/github/callback',
  },
} as const

export type OriginConfig = (typeof ORIGIN_CONFIG)[keyof typeof ORIGIN_CONFIG]

const allowedOrigins = Object.values(ORIGIN_CONFIG) as readonly OriginConfig[]

export function findOriginConfig(url: string | URL): OriginConfig | null {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url
    return allowedOrigins.find((entry) => entry.origin === parsed.origin) ?? null
  } catch {
    return null
  }
}

export function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.some((entry) => entry.origin === origin)
}
