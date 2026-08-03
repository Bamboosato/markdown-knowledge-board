import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  handleAuthSessionRequest,
  type SessionResponse,
} from '../../api/_lib/authSession.js'
import { CSRF_COOKIE_NAME, createCsrfToken } from '../../api/_lib/csrf.js'
import {
  GITHUB_API_VERSION,
  GITHUB_REST_HEADERS,
  GitHubConfigurationError,
  GitHubRefreshTransientError,
  refreshGitHubSession,
} from '../../api/_lib/github.js'
import { ORIGIN_CONFIG } from '../../api/_lib/origins.js'
import {
  parseSessionKeyRing,
  sealSession,
  sessionCookie,
  SessionError,
  SESSION_COOKIE_NAME,
  type SessionPayloadV1,
  unsealSession,
} from '../../api/_lib/session.js'

const NOW = Date.UTC(2026, 7, 3, 4, 0, 0)
const REQUEST_ID = '20000000-0000-4000-8000-000000000002'
const activeKey = Buffer.alloc(32, 1).toString('base64url')
const previousKey = Buffer.alloc(32, 2).toString('base64url')
const keyConfig = JSON.stringify({
  active: { id: 'active', key: activeKey },
  previous: { id: 'previous', key: previousKey },
})

function payload(
  overrides: Partial<SessionPayloadV1> = {},
): SessionPayloadV1 {
  return {
    version: 1,
    user: {
      id: 123,
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/123?v=4',
    },
    accessToken: 'ghu_access',
    accessTokenExpiresAt: NOW + 60 * 60 * 1_000,
    refreshToken: 'ghr_refresh',
    refreshTokenExpiresAt: NOW + 30 * 24 * 60 * 60 * 1_000,
    issuedAt: NOW - 1_000,
    ...overrides,
  }
}

function productionEnv(extra: Record<string, string> = {}) {
  return {
    VERCEL_ENV: 'production',
    SESSION_KEYS: keyConfig,
    ...extra,
  }
}

function sessionRequest(cookie?: string, origin = ORIGIN_CONFIG.primary.origin) {
  const headers = new Headers()
  if (cookie) headers.set('Cookie', cookie)
  return new Request(`${origin}/api/auth/session`, { headers })
}

function tamperSealedSession(value: string): string {
  const parts = value.split('.')
  const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1
  parts[3] = ciphertext.toString('base64url')
  return parts.join('.')
}

async function responseData(response: Response): Promise<SessionResponse> {
  const body = (await response.json()) as {
    ok: true
    data: SessionResponse
    requestId: string
  }
  expect(body.ok).toBe(true)
  expect(body.requestId).toBe(REQUEST_ID)
  return body.data
}

describe('sealed session Cookie', () => {
  it('roundtrips an AES-256-GCM payload and marks the active key', async () => {
    const keyRing = parseSessionKeyRing(keyConfig)
    const sealed = await sealSession(
      payload(),
      keyRing,
      new Uint8Array(12).fill(7),
    )
    const result = await unsealSession(sealed, keyRing)

    expect(sealed).toMatch(/^v1\.active\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(result).toEqual({ payload: payload(), needsRotation: false })
  })

  it('accepts the previous key and requests rotation', async () => {
    const oldRing = parseSessionKeyRing(
      JSON.stringify({ active: { id: 'previous', key: previousKey } }),
    )
    const sealed = await sealSession(payload(), oldRing)
    const result = await unsealSession(sealed, parseSessionKeyRing(keyConfig))

    expect(result.needsRotation).toBe(true)
  })

  it('rejects ciphertext tampering', async () => {
    const ring = parseSessionKeyRing(keyConfig)
    const sealed = await sealSession(payload(), ring)
    const tampered = tamperSealedSession(sealed)

    await expect(unsealSession(tampered, ring)).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    } satisfies Partial<SessionError>)
  })

  it('rejects malformed, duplicate, or non-256-bit key configuration', () => {
    expect(() => parseSessionKeyRing('not-json')).toThrowError(SessionError)
    expect(() =>
      parseSessionKeyRing(
        JSON.stringify({
          active: { id: 'same', key: activeKey },
          previous: { id: 'same', key: previousKey },
        }),
      ),
    ).toThrowError(SessionError)
    expect(() =>
      parseSessionKeyRing(
        JSON.stringify({
          active: {
            id: 'short',
            key: Buffer.alloc(31, 1).toString('base64url'),
          },
        }),
      ),
    ).toThrowError(SessionError)
  })

  it('enforces the 3,800-byte serialized Cookie boundary', async () => {
    const oversized = payload({
      user: { id: 1, login: 'a', avatarUrl: 'x'.repeat(2_048) },
      accessToken: 'a'.repeat(1_024),
      refreshToken: 'b'.repeat(1_024),
    })

    await expect(
      sealSession(oversized, parseSessionKeyRing(keyConfig)),
    ).rejects.toMatchObject({
      code: 'SESSION_TOO_LARGE',
    } satisfies Partial<SessionError>)
  })

  it('serializes a host-only secure session Cookie with refresh-bounded Max-Age', async () => {
    const current = payload({ refreshTokenExpiresAt: NOW + 90_000 })
    const sealed = await sealSession(current, parseSessionKeyRing(keyConfig))
    const cookie = sessionCookie(sealed, current, NOW)

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=90')
    expect(cookie).not.toContain('Domain=')
  })
})

describe('GET /api/auth/session', () => {
  const baseDependencies = {
    env: productionEnv(),
    now: () => NOW,
    createRequestId: () => REQUEST_ID,
  }

  it.each([
    ORIGIN_CONFIG.primary.origin,
    ORIGIN_CONFIG.vercel.origin,
  ])('returns signed-out plus a host-only CSRF Cookie on %s', async (origin) => {
    const response = await handleAuthSessionRequest(
      sessionRequest(undefined, origin),
      baseDependencies,
    )
    const data = await responseData(response)

    expect(data.status).toBe('signed-out')
    expect(data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(response.headers.get('Set-Cookie')).toContain(
      `${CSRF_COOKIE_NAME}=${data.csrfToken}`,
    )
    expect(response.headers.get('Set-Cookie')).not.toContain('Domain=')
  })

  it('rejects Preview before reading session secrets', async () => {
    const loadSessionKeys = vi.fn(() => parseSessionKeyRing(keyConfig))
    const response = await handleAuthSessionRequest(
      new Request('https://example-branch.vercel.app/api/auth/session', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=untrusted` },
      }),
      {
        ...baseDependencies,
        env: { VERCEL_ENV: 'preview' },
        loadSessionKeys,
      },
    )

    expect(response.status).toBe(404)
    expect(loadSessionKeys).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      error: { code: 'CLOUD_NOT_AVAILABLE' },
    })
  })

  it('returns a valid signed-in profile without exposing tokens', async () => {
    const current = payload()
    const sealed = await sealSession(current, parseSessionKeyRing(keyConfig))
    const csrfToken = createCsrfToken()
    const response = await handleAuthSessionRequest(
      sessionRequest(
        `${SESSION_COOKIE_NAME}=${sealed}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
      ),
      baseDependencies,
    )
    const data = await responseData(response)
    const raw = JSON.stringify(data)

    expect(data).toEqual({
      status: 'signed-in',
      user: current.user,
      accessTokenExpiresAt: new Date(current.accessTokenExpiresAt).toISOString(),
      csrfToken,
    })
    expect(raw).not.toContain(current.accessToken)
    expect(raw).not.toContain(current.refreshToken)
  })

  it('reseals a previous-key session with the active key', async () => {
    const oldRing = parseSessionKeyRing(
      JSON.stringify({ active: { id: 'previous', key: previousKey } }),
    )
    const sealed = await sealSession(payload(), oldRing)
    const response = await handleAuthSessionRequest(
      sessionRequest(`${SESSION_COOKIE_NAME}=${sealed}`),
      baseDependencies,
    )

    expect((await responseData(response)).status).toBe('signed-in')
    expect(response.headers.get('Set-Cookie')).toContain(
      `${SESSION_COOKIE_NAME}=v1.active.`,
    )
  })

  it('refreshes a token with five minutes or less remaining', async () => {
    const current = payload({ accessTokenExpiresAt: NOW + 5 * 60 * 1_000 })
    const refreshed = payload({
      accessToken: 'ghu_new',
      refreshToken: 'ghr_new',
      accessTokenExpiresAt: NOW + 8 * 60 * 60 * 1_000,
      issuedAt: NOW,
    })
    const refreshSession = vi.fn(async () => refreshed)
    const sealed = await sealSession(current, parseSessionKeyRing(keyConfig))
    const response = await handleAuthSessionRequest(
      sessionRequest(`${SESSION_COOKIE_NAME}=${sealed}`),
      { ...baseDependencies, refreshSession },
    )
    const data = await responseData(response)

    expect(refreshSession).toHaveBeenCalledWith(current, {
      env: baseDependencies.env,
      now: NOW,
    })
    expect(data.status).toBe('signed-in')
    if (data.status === 'signed-in') {
      expect(data.accessTokenExpiresAt).toBe(
        new Date(refreshed.accessTokenExpiresAt).toISOString(),
      )
    }
    expect(response.headers.get('Set-Cookie')).toContain(
      `${SESSION_COOKIE_NAME}=v1.active.`,
    )
  })

  it.each([
    ['refresh rejection', false],
    ['expired refresh token', true],
  ])('clears the session and requires reauthorization on %s', async (_label, expired) => {
    const current = payload({
      accessTokenExpiresAt: NOW,
      refreshTokenExpiresAt: expired ? NOW : NOW + 60_000,
    })
    const refreshSession = vi.fn(async () => null)
    const sealed = await sealSession(current, parseSessionKeyRing(keyConfig))
    const response = await handleAuthSessionRequest(
      sessionRequest(`${SESSION_COOKIE_NAME}=${sealed}`),
      { ...baseDependencies, refreshSession },
    )

    expect((await responseData(response)).status).toBe(
      'reauthorization-required',
    )
    expect(response.headers.get('Set-Cookie')).toContain(
      `${SESSION_COOKIE_NAME}=;`,
    )
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(refreshSession).toHaveBeenCalledTimes(expired ? 0 : 1)
  })

  it('clears a tampered session without throwing or echoing it', async () => {
    const current = await sealSession(payload(), parseSessionKeyRing(keyConfig))
    const tampered = tamperSealedSession(current)
    const response = await handleAuthSessionRequest(
      sessionRequest(`${SESSION_COOKIE_NAME}=${tampered}`),
      baseDependencies,
    )
    const responseCopy = response.clone()

    expect((await responseData(response)).status).toBe(
      'reauthorization-required',
    )
    expect(await responseCopy.text()).not.toContain(tampered)
  })

  it('returns a retryable server error without deleting the session on key misconfiguration', async () => {
    const response = await handleAuthSessionRequest(
      sessionRequest(`${SESSION_COOKIE_NAME}=v1.key.iv.ciphertext`),
      { ...baseDependencies, env: { VERCEL_ENV: 'production' } },
    )
    const body = (await response.json()) as {
      error: { code: string; retryable: boolean; stage: string }
    }

    expect(response.status).toBe(500)
    expect(body.error).toEqual({
      code: 'SESSION_UNAVAILABLE',
      message: 'GitHub session could not be checked.',
      retryable: true,
      stage: 'auth-check',
    })
    expect(response.headers.get('Set-Cookie')).not.toContain(
      `${SESSION_COOKIE_NAME}=;`,
    )
  })

  it.each([
    ['timeout', 504, 'SESSION_CHECK_TIMEOUT'],
    ['unavailable', 503, 'SESSION_CHECK_UNAVAILABLE'],
  ] as const)(
    'preserves the session when refresh is temporarily %s',
    async (kind, status, code) => {
      const current = payload({ accessTokenExpiresAt: NOW })
      const sealed = await sealSession(current, parseSessionKeyRing(keyConfig))
      const response = await handleAuthSessionRequest(
        sessionRequest(`${SESSION_COOKIE_NAME}=${sealed}`),
        {
          ...baseDependencies,
          refreshSession: vi.fn(async () => {
            throw new GitHubRefreshTransientError(kind)
          }),
        },
      )
      const body = (await response.json()) as {
        error: { code: string; retryable: boolean }
      }

      expect(response.status).toBe(status)
      expect(body.error).toMatchObject({ code, retryable: true })
      expect(response.headers.get('Set-Cookie')).not.toContain(
        `${SESSION_COOKIE_NAME}=;`,
      )
    },
  )

  it('returns 405 for state-changing methods in Production', async () => {
    const response = await handleAuthSessionRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/session`, {
        method: 'POST',
      }),
      baseDependencies,
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })
})

describe('GitHub token refresh adapter', () => {
  it('uses the documented refresh grant and rotates both tokens', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(input).toBe('https://github.com/login/oauth/access_token')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
      const body = init?.body as URLSearchParams
      expect(body.get('client_id')).toBe('client-id')
      expect(body.get('client_secret')).toBe('client-secret')
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('ghr_refresh')
      return Response.json({
        access_token: 'ghu_rotated',
        expires_in: 28_800,
        refresh_token: 'ghr_rotated',
        refresh_token_expires_in: 15_897_600,
      })
    })

    const result = await refreshGitHubSession(payload(), {
      env: {
        GITHUB_APP_CLIENT_ID: 'client-id',
        GITHUB_APP_CLIENT_SECRET: 'client-secret',
      },
      now: NOW,
      fetchImpl,
    })

    expect(result).toMatchObject({
      accessToken: 'ghu_rotated',
      accessTokenExpiresAt: NOW + 28_800_000,
      refreshToken: 'ghr_rotated',
      refreshTokenExpiresAt: NOW + 15_897_600_000,
      issuedAt: NOW,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats a rejected refresh token as reauthorization', async () => {
    const rejected = await refreshGitHubSession(payload(), {
      env: {
        GITHUB_APP_CLIENT_ID: 'client-id',
        GITHUB_APP_CLIENT_SECRET: 'client-secret',
      },
      now: NOW,
      fetchImpl: vi.fn(async () => new Response('denied', { status: 401 })),
    })

    expect(rejected).toBeNull()
  })

  it.each([
    ['malformed success', vi.fn(async () => Response.json({ access_token: 'partial' }))],
    ['server failure', vi.fn(async () => new Response(null, { status: 503 }))],
    [
      'network failure',
      vi.fn(async () => {
        throw new TypeError('network unavailable')
      }),
    ],
  ])('keeps the current session on transient %s', async (_label, fetchImpl) => {
    await expect(
      refreshGitHubSession(payload(), {
      env: {
        GITHUB_APP_CLIENT_ID: 'client-id',
        GITHUB_APP_CLIENT_SECRET: 'client-secret',
      },
      now: NOW,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(GitHubRefreshTransientError)
  })

  it('keeps server misconfiguration distinct from revoked authorization', async () => {
    await expect(
      refreshGitHubSession(payload(), { env: {}, now: NOW }),
    ).rejects.toBeInstanceOf(GitHubConfigurationError)
  })

  it('pins the currently supported GitHub REST version and media type', () => {
    expect(GITHUB_API_VERSION).toBe('2026-03-10')
    expect(GITHUB_REST_HEADERS).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    })
  })
})
