import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloudApiError,
  downloadCloudBackup,
  getCsrfToken,
  sha256Base64Url,
} from '../../src/lib/cloudApi'

const GIST_ID = 'a1'
const REVISION = 'a'.repeat(40)
const UPDATED_AT = '2026-08-03T05:00:00.000Z'
const CONTENT_TYPE = 'application/vnd.mkb.encrypted-backup+json'

beforeEach(() => {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  })
  vi.stubGlobal('navigator', { onLine: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function encryptedResponse(
  content: Uint8Array,
  overrides: Record<string, string> = {},
): Promise<Response> {
  const sha256 = await sha256Base64Url(content)
  return new Response(content, {
    headers: {
      'Content-Type': CONTENT_TYPE,
      'Content-Length': String(content.byteLength),
      'X-MKB-Gist-Id': GIST_ID,
      'X-MKB-Revision': REVISION,
      'X-MKB-Gist-Updated-At': UPDATED_AT,
      'X-MKB-Content-SHA256': sha256,
      ...overrides,
    },
  })
}

describe('cloud backup download client', () => {
  it('returns encrypted bytes only after all response metadata and the hash match', async () => {
    const content = new TextEncoder().encode('{"encrypted":true}')
    const fetchImpl = vi.fn(async () => encryptedResponse(content))
    vi.stubGlobal('fetch', fetchImpl)

    await expect(downloadCloudBackup(GIST_ID)).resolves.toMatchObject({
      gistId: GIST_ID,
      revision: REVISION,
      updatedAt: UPDATED_AT,
      content,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/cloud-backups/content?gistId=${GIST_ID}`,
      expect.objectContaining({
        credentials: 'same-origin',
        redirect: 'error',
      }),
    )
  })

  it('preserves a structured API error instead of treating it as encrypted content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: {
              code: 'GIST_NOT_FOUND',
              message: 'GitHub could not complete the cloud backup request.',
              retryable: false,
              stage: 'restore-download',
            },
            requestId: 'request-1',
          },
          { status: 404 },
        ),
      ),
    )

    await expect(downloadCloudBackup(GIST_ID)).rejects.toMatchObject<CloudApiError>({
      code: 'GIST_NOT_FOUND',
      stage: 'restore-download',
      requestId: 'request-1',
    })
  })

  it('rejects hash and content-length mismatches without exposing unverified bytes', async () => {
    const content = new TextEncoder().encode('ciphertext')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        encryptedResponse(content, {
          'X-MKB-Content-SHA256': 'a'.repeat(43),
        }),
      ),
    )
    await expect(downloadCloudBackup(GIST_ID)).rejects.toMatchObject<CloudApiError>({
      code: 'CONTENT_SHA256_MISMATCH',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        encryptedResponse(content, {
          'Content-Length': String(content.byteLength + 1),
        }),
      ),
    )
    await expect(downloadCloudBackup(GIST_ID)).rejects.toMatchObject<CloudApiError>({
      code: 'INVALID_RESPONSE',
    })
  })

  it('rejects declared data above 4,500,000 bytes before reading it', async () => {
    const content = new TextEncoder().encode('ciphertext')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        encryptedResponse(content, { 'Content-Length': '4500001' }),
      ),
    )
    await expect(downloadCloudBackup(GIST_ID)).rejects.toMatchObject<CloudApiError>({
      code: 'INVALID_RESPONSE',
    })
  })
})

describe('GitHub session recovery client', () => {
  it('gets a CSRF token through the same-origin bootstrap endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ok: true,
        data: { csrfToken: 'a'.repeat(43) },
        requestId: 'request-1',
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)

    await expect(getCsrfToken()).resolves.toEqual({ csrfToken: 'a'.repeat(43) })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/csrf',
      expect.objectContaining({
        credentials: 'same-origin',
        redirect: 'error',
      }),
    )
  })
})
