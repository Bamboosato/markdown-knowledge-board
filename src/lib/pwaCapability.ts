import { CLOUD_PRODUCTION_ORIGINS } from './cloudCapability'

export type PwaCapability =
  | { status: 'enabled'; mode: 'production' | 'test' }
  | { status: 'disabled' }
  | { status: 'unsupported' }

type PwaCapabilityInput = {
  url: URL
  serviceWorkerSupported: boolean
  productionEnabled: boolean
  testEnabled: boolean
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

export function resolvePwaCapability({
  url,
  serviceWorkerSupported,
  productionEnabled,
  testEnabled,
}: PwaCapabilityInput): PwaCapability {
  if (!serviceWorkerSupported) return { status: 'unsupported' }

  if (
    productionEnabled &&
    url.protocol === 'https:' &&
    CLOUD_PRODUCTION_ORIGINS.includes(
      url.origin as (typeof CLOUD_PRODUCTION_ORIGINS)[number],
    )
  ) {
    return { status: 'enabled', mode: 'production' }
  }

  if (testEnabled && isLoopbackHostname(url.hostname)) {
    return { status: 'enabled', mode: 'test' }
  }

  return { status: 'disabled' }
}

export function getPwaCapability(
  url = new URL(window.location.href),
): PwaCapability {
  return resolvePwaCapability({
    url,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    productionEnabled: import.meta.env.VITE_PWA_ENABLED === 'true',
    testEnabled: import.meta.env.VITE_PWA_TEST_ENABLED === 'true',
  })
}
