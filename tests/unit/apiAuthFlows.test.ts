import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import csrfHandler from '../../api/auth/csrf.js'
import {
  handleAuthCallbackRequest,
  handleAuthStartRequest,
  handleCsrfRequest,
  handleDisconnectRequest,
  handleSignOutRequest,
} from '../../api/_lib/authFlows.js'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfToken,
} from '../../api/_lib/csrf.js'
import {
  createPkceChallenge,
  exchangeGitHubCode,
  getAuthenticatedGitHubUser,
  revokeGitHubToken,
} from '../../api/_lib/github.js'
import {
  OAUTH_STATE_COOKIE_NAME,
  oauthStateCookie,
  sealOAuthState,
  unsealOAuthState,
} from '../../api/_lib/oauthState.js'
import { ORIGIN_CONFIG } from '../../api/_lib/origins.js'
import {
  parseSessionKeyRing,
  sealSession,
  SESSION_COOKIE_NAME,
  type SessionPayloadV1,
  unsealSession,
} from '../../api/_lib/session.js'

const NOW = Date.UTC(2026, 7, 3, 5, 0, 0)
const REQUEST_ID = '30000000-0000-4000-8000-000000000003'
const STATE = Buffer.alloc(32, 3).toString('base64url')
const VERIFIER = Buffer.alloc(32, 4).toString('base64url')
const keyConfig = JSON.stringify({
  active: { id: 'active', key: Buffer.alloc(32, 5).toString('base64url') },
})

function productionEnv() {
  return {
    VERCEL_ENV: 'production',
    SESSION_KEYS: keyConfig,
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'client-secret',
  }
}

const baseDependencies = {
  env: productionEnv(),
  now: () => NOW,
  createRequestId: () => REQUEST_ID,
}

function getSetCookies(response: Response): string[] {
  return response.headers.getSetCookie()
}

function cookieValue(cookies: readonly string[], name: string): string {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Missing ${name}`)
  return cookie.slice(name.length + 1).split(';')[0] ?? ''
}

async function oauthCookie(
  originKey: 'primary' | 'vercel' = 'primary',
  overrides: Partial<{ state: string; expiresAt: number }> = {},
) {
  const expiresAt = overrides.expiresAt ?? NOW + 600_000
  const sealed = await sealOAuthState(
    {
      version: 1,
      state: overrides.state ?? STATE,
      codeVerifier: VERIFIER,
      originKey,
      returnPath: '/',
      issuedAt: Math.min(NOW, expiresAt - 1_000),
      expiresAt,
    },
    parseSessionKeyRing(keyConfig),
  )
  return oauthStateCookie(sealed).split(';')[0] ?? ''
}

function sessionPayload(): SessionPayloadV1 {
  return {
    version: 1,
    user: { id: 123, login: 'octocat', avatarUrl: 'https://example.test/a' },
    accessToken: 'ghu_access',
    accessTokenExpiresAt: NOW + 3_600_000,
    refreshToken: 'ghr_refresh',
    refreshTokenExpiresAt: NOW + 86_400_000,
    issuedAt: NOW,
  }
}

describe('GET /api/auth/github/start', () => {
  it.each([
    ORIGIN_CONFIG.primary,
    ORIGIN_CONFIG.vercel,
  ])('starts a state-bound PKCE flow for $key Production Origin', async (origin) => {
    const random = vi.fn().mockReturnValueOnce(STATE).mockReturnValueOnce(VERIFIER)
    const response = await handleAuthStartRequest(
      new Request(`${origin.origin}/api/auth/github/start?returnPath=%2F`),
      { ...baseDependencies, createRandomValue: random },
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location') ?? '')
    expect(location.origin + location.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    )
    expect(location.searchParams.get('client_id')).toBe('Iv1.client')
    expect(location.searchParams.get('redirect_uri')).toBe(origin.callbackUrl)
    expect(location.searchParams.get('state')).toBe(STATE)
    expect(location.searchParams.get('code_challenge')).toBe(
      createPkceChallenge(VERIFIER),
    )
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')

    const cookies = getSetCookies(response)
    const stateCookie = cookies.find((value) =>
      value.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`),
    )
    expect(stateCookie).toContain('HttpOnly')
    expect(stateCookie).toContain('Secure')
    expect(stateCookie).toContain('SameSite=Lax')
    expect(stateCookie).toContain('Path=/')
    expect(stateCookie).toContain('Max-Age=600')
    expect(stateCookie).not.toContain('Domain=')
    const state = await unsealOAuthState(
      cookieValue(cookies, OAUTH_STATE_COOKIE_NAME),
      parseSessionKeyRing(keyConfig),
    )
    expect(state).toMatchObject({
      state: STATE,
      codeVerifier: VERIFIER,
      originKey: origin.key,
      returnPath: '/',
    })
  })

  it('rejects an external return path before creating OAuth state', async () => {
    const createRandomValue = vi.fn(() => STATE)
    const response = await handleAuthStartRequest(
      new Request(
        `${ORIGIN_CONFIG.primary.origin}/api/auth/github/start?returnPath=https%3A%2F%2Fevil.test`,
      ),
      { ...baseDependencies, createRandomValue },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RETURN_PATH' },
    })
    expect(createRandomValue).not.toHaveBeenCalled()
  })

  it('rejects Preview before reading OAuth configuration', async () => {
    const createRandomValue = vi.fn(() => STATE)
    const response = await handleAuthStartRequest(
      new Request('https://branch.vercel.app/api/auth/github/start'),
      {
        env: { VERCEL_ENV: 'preview' },
        createRequestId: () => REQUEST_ID,
        createRandomValue,
      },
    )
    expect(response.status).toBe(404)
    expect(createRandomValue).not.toHaveBeenCalled()
  })
})

describe('GET /api/auth/github/callback', () => {
  it('sets a sealed session and never starts backup or restore', async () => {
    const exchangeCode = vi.fn(async () => ({
      accessToken: 'ghu_new',
      accessTokenExpiresIn: 28_800,
      refreshToken: 'ghr_new',
      refreshTokenExpiresIn: 15_897_600,
    }))
    const getUser = vi.fn(async () => ({
      id: 123,
      login: 'octocat',
      avatarUrl: 'https://example.test/avatar',
    }))
    const response = await handleAuthCallbackRequest(
      new Request(
        `${ORIGIN_CONFIG.primary.callbackUrl}?code=one-time&state=${STATE}`,
        { headers: { Cookie: await oauthCookie() } },
      ),
      { ...baseDependencies, exchangeCode, getUser },
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(
      `${ORIGIN_CONFIG.primary.origin}/?auth=connected`,
    )
    expect(exchangeCode).toHaveBeenCalledWith({
      code: 'one-time',
      codeVerifier: VERIFIER,
      redirectUri: ORIGIN_CONFIG.primary.callbackUrl,
      env: productionEnv(),
    })
    expect(getUser).toHaveBeenCalledWith('ghu_new')
    const cookies = getSetCookies(response)
    expect(cookies).toHaveLength(3)
    expect(cookies[0]).toContain(`${OAUTH_STATE_COOKIE_NAME}=;`)
    expect(cookies.some((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`))).toBe(
      true,
    )
    const session = await unsealSession(
      cookieValue(cookies, SESSION_COOKIE_NAME),
      parseSessionKeyRing(keyConfig),
    )
    expect(session.payload).toMatchObject({
      user: { id: 123, login: 'octocat' },
      accessToken: 'ghu_new',
      refreshToken: 'ghr_new',
    })
  })

  it.each([
    ['mismatched state', `${STATE.slice(0, -1)}A`, NOW + 600_000, 'state_invalid'],
    ['expired state', STATE, NOW - 1, 'state_invalid'],
  ])('rejects %s before code exchange', async (_label, state, expiresAt, code) => {
    const exchangeCode = vi.fn()
    const response = await handleAuthCallbackRequest(
      new Request(
        `${ORIGIN_CONFIG.primary.callbackUrl}?code=secret&state=${state}`,
        { headers: { Cookie: await oauthCookie('primary', { expiresAt }) } },
      ),
      { ...baseDependencies, exchangeCode },
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toContain(
      `auth=error&code=${code}`,
    )
    expect(response.headers.get('Location')).not.toContain('secret')
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(getSetCookies(response)[0]).toContain(`${OAUTH_STATE_COOKIE_NAME}=;`)
  })

  it('maps a user cancellation to a safe code after validating state', async () => {
    const response = await handleAuthCallbackRequest(
      new Request(
        `${ORIGIN_CONFIG.primary.callbackUrl}?error=access_denied&error_description=secret&state=${STATE}`,
        { headers: { Cookie: await oauthCookie() } },
      ),
      baseDependencies,
    )
    expect(response.headers.get('Location')).toBe(
      `${ORIGIN_CONFIG.primary.origin}/?auth=error&code=access_denied`,
    )
  })

  it('rejects a state Cookie issued for the other Production Origin', async () => {
    const exchangeCode = vi.fn()
    const response = await handleAuthCallbackRequest(
      new Request(`${ORIGIN_CONFIG.vercel.callbackUrl}?code=code&state=${STATE}`, {
        headers: { Cookie: await oauthCookie('primary') },
      }),
      { ...baseDependencies, exchangeCode },
    )
    expect(response.headers.get('Location')).toBe(
      `${ORIGIN_CONFIG.vercel.origin}/?auth=error&code=origin_invalid`,
    )
    expect(exchangeCode).not.toHaveBeenCalled()
  })
})

describe('POST signout and disconnect', () => {
  function csrfHeaders(csrf: string, session?: string) {
    const cookie = [
      `${CSRF_COOKIE_NAME}=${csrf}`,
      session ? `${SESSION_COOKIE_NAME}=${session}` : null,
    ]
      .filter(Boolean)
      .join('; ')
    return {
      Origin: ORIGIN_CONFIG.primary.origin,
      Cookie: cookie,
      [CSRF_HEADER_NAME]: csrf,
    }
  }

  it('signs out by clearing auth cookies without contacting GitHub', async () => {
    const csrf = createCsrfToken()
    const response = handleSignOutRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/signout`, {
        method: 'POST',
        headers: csrfHeaders(csrf),
      }),
      baseDependencies,
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { signedOut: true },
    })
    expect(getSetCookies(response)).toHaveLength(3)
    for (const cookie of getSetCookies(response)) expect(cookie).toContain('Max-Age=0')
  })

  it.each([
    ['succeeded', true, undefined],
    ['failed', false, 'https://github.com/settings/applications'],
  ] as const)(
    'ends the local session when token revocation %s',
    async (revocation, revoked, settingsUrl) => {
      const csrf = createCsrfToken()
      const payload = sessionPayload()
      const sealed = await sealSession(payload, parseSessionKeyRing(keyConfig))
      const revokeToken = vi.fn(async () => revoked)
      const response = await handleDisconnectRequest(
        new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/disconnect`, {
          method: 'POST',
          headers: csrfHeaders(csrf, sealed),
        }),
        { ...baseDependencies, revokeToken },
      )
      expect(await response.json()).toMatchObject({
        ok: true,
        data: {
          disconnected: true,
          revocation,
          ...(settingsUrl ? { githubSettingsUrl: settingsUrl } : {}),
        },
      })
      expect(revokeToken).toHaveBeenCalledWith('ghu_access', productionEnv())
      expect(getSetCookies(response)).toHaveLength(3)
    },
  )

  it('does not revoke when CSRF is invalid', async () => {
    const revokeToken = vi.fn()
    const response = await handleDisconnectRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/disconnect`, {
        method: 'POST',
        headers: { Origin: ORIGIN_CONFIG.primary.origin },
      }),
      { ...baseDependencies, revokeToken },
    )
    expect(response.status).toBe(403)
    expect(revokeToken).not.toHaveBeenCalled()
  })
})

describe('GET /api/auth/csrf', () => {
  it('exposes the Vercel fetch adapter used by the deployed function', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    try {
      const response = await csrfHandler.fetch(
        new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/csrf`),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        ok: true,
        data: { csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('returns a CSRF token and bootstraps the host-only cookie', async () => {
    const response = handleCsrfRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/csrf`),
      baseDependencies,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: { csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) },
    })
    expect(getSetCookies(response)).toHaveLength(1)
    expect(getSetCookies(response)[0]).toContain(
      `${CSRF_COOKIE_NAME}=${body.data.csrfToken}`,
    )
    expect(getSetCookies(response)[0]).toContain('HttpOnly')
  })

  it('reuses a valid CSRF cookie without issuing a replacement', async () => {
    const csrf = createCsrfToken()
    const response = handleCsrfRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/csrf`, {
        headers: { Cookie: `${CSRF_COOKIE_NAME}=${csrf}` },
      }),
      baseDependencies,
    )

    expect((await response.json()).data.csrfToken).toBe(csrf)
    expect(getSetCookies(response)).toHaveLength(0)
  })

  it('rejects non-GET methods and remains unavailable outside Production', async () => {
    const methodResponse = handleCsrfRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/csrf`, {
        method: 'POST',
      }),
      baseDependencies,
    )
    expect(methodResponse.status).toBe(405)

    const previewResponse = handleCsrfRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/auth/csrf`),
      { ...baseDependencies, env: { VERCEL_ENV: 'preview' } },
    )
    expect(previewResponse.status).toBe(404)
    expect(getSetCookies(previewResponse)).toHaveLength(0)
  })
})

describe('GitHub OAuth adapters', () => {
  it('exchanges a PKCE code and validates the expiring token shape', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain(`code_verifier=${VERIFIER}`)
      return Response.json({
        access_token: 'ghu_access',
        expires_in: 28_800,
        refresh_token: 'ghr_refresh',
        refresh_token_expires_in: 15_897_600,
      })
    })
    await expect(
      exchangeGitHubCode({
        code: 'code',
        codeVerifier: VERIFIER,
        redirectUri: ORIGIN_CONFIG.primary.callbackUrl,
        env: productionEnv(),
        fetchImpl,
      }),
    ).resolves.toMatchObject({ accessToken: 'ghu_access' })
  })

  it('keeps only the authenticated user profile fields', async () => {
    const user = await getAuthenticatedGitHubUser({
      accessToken: 'ghu_access',
      fetchImpl: vi.fn(async () =>
        Response.json({
          id: 123,
          login: 'octocat',
          avatar_url: 'https://example.test/avatar',
          email: 'must-not-be-retained@example.test',
        }),
      ),
    })
    expect(user).toEqual({
      id: 123,
      login: 'octocat',
      avatarUrl: 'https://example.test/avatar',
    })
  })

  it('revokes only the current token with application Basic auth', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE')
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        `Basic ${Buffer.from('Iv1.client:client-secret').toString('base64')}`,
      )
      expect(init?.body).toBe(JSON.stringify({ access_token: 'ghu_access' }))
      return new Response(null, { status: 204 })
    })
    await expect(
      revokeGitHubToken({
        accessToken: 'ghu_access',
        env: productionEnv(),
        fetchImpl,
      }),
    ).resolves.toBe(true)
  })
})
