export type CloudCapability = 'enabled' | 'local-only'

export const CLOUD_PRODUCTION_ORIGINS = [
  'https://mkb.bamboosato.com',
  'https://markdown-knowledge-board.vercel.app',
] as const

export const CLOUD_PRIMARY_ORIGIN = CLOUD_PRODUCTION_ORIGINS[0]
export const CLOUD_SECONDARY_ORIGIN = CLOUD_PRODUCTION_ORIGINS[1]

export function resolveCloudCapability(
  origin: string,
  featureEnabled: boolean,
): CloudCapability {
  return featureEnabled &&
    CLOUD_PRODUCTION_ORIGINS.some((allowed) => allowed === origin)
    ? 'enabled'
    : 'local-only'
}

function isLoopbackOrigin(url: URL): boolean {
  return (
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    (url.protocol === 'http:' || url.protocol === 'https:')
  )
}

export function getCloudCapability(url = new URL(window.location.href)):
  | {
      status: 'enabled'
      origin: string
      isSecondaryOrigin: boolean
    }
  | { status: 'local-only' } {
  const productionEnabled =
    resolveCloudCapability(
      url.origin,
      import.meta.env.VITE_CLOUD_BACKUP_ENABLED === 'true',
    ) === 'enabled'
  const localStubEnabled =
    import.meta.env.DEV &&
    isLoopbackOrigin(url) &&
    url.searchParams.get('cloudTest') === '1'

  if (!productionEnabled && !localStubEnabled) return { status: 'local-only' }
  return {
    status: 'enabled',
    origin: url.origin,
    isSecondaryOrigin: url.origin === CLOUD_SECONDARY_ORIGIN,
  }
}
