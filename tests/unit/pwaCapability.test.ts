import { describe, expect, it } from 'vitest'

import { resolvePwaCapability } from '../../src/lib/pwaCapability'

// Test viewpoints:
// - Functional: production and explicit loopback test builds are enabled.
// - Non-functional/security: preview and untrusted origins never register a worker.
// - Data: URL protocol, origin, hostname, and feature flags are independent inputs.
// - Boundary/state: missing browser support wins over every enabled flag.
describe('resolvePwaCapability', () => {
  it('enables an approved HTTPS production origin', () => {
    expect(
      resolvePwaCapability({
        url: new URL('https://mkb.bamboosato.com/notes'),
        serviceWorkerSupported: true,
        productionEnabled: true,
        testEnabled: false,
      }),
    ).toEqual({ status: 'enabled', mode: 'production' })
  })

  it('enables only an explicit loopback PWA test build', () => {
    expect(
      resolvePwaCapability({
        url: new URL('http://127.0.0.1:4173/'),
        serviceWorkerSupported: true,
        productionEnabled: false,
        testEnabled: true,
      }),
    ).toEqual({ status: 'enabled', mode: 'test' })
  })

  it.each([
    'https://preview-markdown-knowledge-board.vercel.app/',
    'http://mkb.bamboosato.com/',
    'https://example.com/',
  ])('keeps an unapproved production URL disabled: %s', (url) => {
    expect(
      resolvePwaCapability({
        url: new URL(url),
        serviceWorkerSupported: true,
        productionEnabled: true,
        testEnabled: false,
      }),
    ).toEqual({ status: 'disabled' })
  })

  it('does not enable test mode from a query parameter or remote host', () => {
    expect(
      resolvePwaCapability({
        url: new URL('https://example.com/?pwaTest=1'),
        serviceWorkerSupported: true,
        productionEnabled: false,
        testEnabled: true,
      }),
    ).toEqual({ status: 'disabled' })
  })

  it('reports unsupported before considering flags or origin', () => {
    expect(
      resolvePwaCapability({
        url: new URL('https://mkb.bamboosato.com/'),
        serviceWorkerSupported: false,
        productionEnabled: true,
        testEnabled: true,
      }),
    ).toEqual({ status: 'unsupported' })
  })
})
