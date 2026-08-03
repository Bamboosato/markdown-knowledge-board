import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  BodyReadError,
  ENCRYPTED_BACKUP_MAX_BYTES,
  readRawBodyWithLimit,
} from '../../api/_lib/body.js'
import {
  createCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  validateStateChangingRequest,
} from '../../api/_lib/csrf.js'
import { requireProductionCloudEnvironment } from '../../api/_lib/environment.js'
import { apiError, apiSuccess } from '../../api/_lib/http.js'
import {
  findOriginConfig,
  ORIGIN_CONFIG,
} from '../../api/_lib/origins.js'

const REQUEST_ID = '10000000-0000-4000-8000-000000000001'

describe('Production cloud environment gate', () => {
  it.each([
    ORIGIN_CONFIG.primary.origin,
    ORIGIN_CONFIG.vercel.origin,
  ])('accepts the exact Production Origin: %s', (origin) => {
    const result = requireProductionCloudEnvironment(
      new Request(`${origin}/api/auth/session`),
      REQUEST_ID,
      { VERCEL_ENV: 'production' },
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.origin.origin).toBe(origin)
  })

  it.each([
    ['preview environment', 'preview', ORIGIN_CONFIG.primary.origin],
    ['development environment', 'development', ORIGIN_CONFIG.primary.origin],
    ['missing environment', undefined, ORIGIN_CONFIG.primary.origin],
    [
      'Vercel Preview URL',
      'production',
      'https://markdown-knowledge-board-git-example.vercel.app',
    ],
    ['localhost', 'production', 'http://localhost:5173'],
    [
      'allowlist suffix lookalike',
      'production',
      'https://mkb.bamboosato.com.example.com',
    ],
  ])('rejects %s before cloud processing', async (_label, vercelEnv, origin) => {
    const result = requireProductionCloudEnvironment(
      new Request(`${origin}/api/auth/session`),
      REQUEST_ID,
      { VERCEL_ENV: vercelEnv },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(404)
      expect(await result.response.json()).toMatchObject({
        ok: false,
        error: { code: 'CLOUD_NOT_AVAILABLE', retryable: false },
        requestId: REQUEST_ID,
      })
    }
  })

  it('does not derive an Origin from an invalid URL or a suffix match', () => {
    expect(findOriginConfig('not a URL')).toBeNull()
    expect(
      findOriginConfig('https://markdown-knowledge-board.vercel.app.evil.test'),
    ).toBeNull()
  })
})

describe('common API response contract', () => {
  it('returns no-store JSON with the server-generated request ID', async () => {
    const response = apiSuccess({ status: 'ok' }, REQUEST_ID)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(response.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(await response.json()).toEqual({
      ok: true,
      data: { status: 'ok' },
      requestId: REQUEST_ID,
    })
  })

  it('returns only the safe error envelope', async () => {
    const response = apiError(
      500,
      'SESSION_UNAVAILABLE',
      'GitHub session could not be checked.',
      true,
      REQUEST_ID,
      { stage: 'auth-check' },
    )

    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'SESSION_UNAVAILABLE',
        message: 'GitHub session could not be checked.',
        retryable: true,
        stage: 'auth-check',
      },
      requestId: REQUEST_ID,
    })
  })
})

describe('Origin and double-submit CSRF validation', () => {
  it.each([
    ORIGIN_CONFIG.primary.origin,
    ORIGIN_CONFIG.vercel.origin,
  ])('accepts a matching token on an exact Origin: %s', (origin) => {
    const token = createCsrfToken()
    const request = new Request(`${origin}/api/auth/signout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `${CSRF_COOKIE_NAME}=${token}`,
        [CSRF_HEADER_NAME]: token,
      },
    })

    expect(validateStateChangingRequest(request)).toEqual({ ok: true })
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it.each([
    ['missing Origin', null, ORIGIN_CONFIG.primary.origin],
    [
      'different allowed Origin',
      ORIGIN_CONFIG.vercel.origin,
      ORIGIN_CONFIG.primary.origin,
    ],
    [
      'suffix lookalike',
      'https://mkb.bamboosato.com.example.com',
      ORIGIN_CONFIG.primary.origin,
    ],
  ])('rejects %s', (_label, headerOrigin, requestOrigin) => {
    const token = createCsrfToken()
    const headers = new Headers({
      Cookie: `${CSRF_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: token,
    })
    if (headerOrigin) headers.set('Origin', headerOrigin)

    expect(
      validateStateChangingRequest(
        new Request(`${requestOrigin}/api/auth/signout`, {
          method: 'POST',
          headers,
        }),
      ),
    ).toEqual({ ok: false, code: 'ORIGIN_MISMATCH' })
  })

  it.each([
    ['missing Cookie', false, true],
    ['missing header', true, false],
    ['mismatched token', true, true],
  ])('rejects a request with %s', (_label, includeCookie, includeHeader) => {
    const token = createCsrfToken()
    const otherToken = createCsrfToken()
    const headers = new Headers({ Origin: ORIGIN_CONFIG.primary.origin })
    if (includeCookie) headers.set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
    if (includeHeader) headers.set(CSRF_HEADER_NAME, otherToken)

    expect(
      validateStateChangingRequest(
        new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/signout`, {
          method: 'POST',
          headers,
        }),
      ),
    ).toEqual({ ok: false, code: 'CSRF_INVALID' })
  })
})

describe('encrypted backup raw body limit', () => {
  it('accepts exactly 4,500,000 bytes', async () => {
    const source = new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES)
    const body = await readRawBodyWithLimit(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/cloud-backups/example`, {
        method: 'PUT',
        body: source,
      }),
    )

    expect(body.byteLength).toBe(4_500_000)
  })

  it('rejects 4,500,001 streamed bytes', async () => {
    const request = new Request(
      `${ORIGIN_CONFIG.primary.origin}/api/cloud-backups/example`,
      {
        method: 'PUT',
        body: new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES + 1),
      },
    )

    await expect(readRawBodyWithLimit(request)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    } satisfies Partial<BodyReadError>)
  })

  it('rejects an oversized Content-Length before reading the body', async () => {
    const request = new Request(
      `${ORIGIN_CONFIG.primary.origin}/api/cloud-backups/example`,
      {
        method: 'PUT',
        headers: { 'Content-Length': '4500001' },
        body: new Uint8Array([1]),
      },
    )

    await expect(readRawBodyWithLimit(request)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    } satisfies Partial<BodyReadError>)
  })

  it.each([
    ['invalid Content-Length', { 'Content-Length': '-1' }, 'INVALID_CONTENT_LENGTH'],
    ['compressed body', { 'Content-Encoding': 'gzip' }, 'UNSUPPORTED_CONTENT_ENCODING'],
  ])('rejects %s', async (_label, headers, code) => {
    const request = new Request(
      `${ORIGIN_CONFIG.primary.origin}/api/cloud-backups/example`,
      { method: 'PUT', headers, body: new Uint8Array([1]) },
    )

    await expect(readRawBodyWithLimit(request)).rejects.toMatchObject({ code })
  })
})
