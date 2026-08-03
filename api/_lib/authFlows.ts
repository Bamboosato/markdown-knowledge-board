import { timingSafeEqual } from 'node:crypto'
import { parseCookies } from './cookies.js'
import {
  clearCsrfCookie,
  createCsrfToken,
  csrfCookie,
  validateStateChangingRequest,
} from './csrf.js'
import {
  requireProductionCloudEnvironment,
  type ServerEnvironment,
} from './environment.js'
import {
  buildGitHubAuthorizationUrl,
  createOAuthRandomValue,
  createPkceChallenge,
  exchangeGitHubCode,
  getAuthenticatedGitHubUser,
  revokeGitHubToken,
  type GitHubTokenExchange,
  type GitHubUser,
} from './github.js'
import {
  apiError,
  apiSuccess,
  createRequestId,
  methodNotAllowed,
} from './http.js'
import {
  clearOAuthStateCookie,
  oauthStateCookie,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_SECONDS,
  sealOAuthState,
  unsealOAuthState,
  type OAuthStatePayloadV1,
} from './oauthState.js'
import {
  clearSessionCookie,
  loadSessionKeyRing,
  sealSession,
  sessionCookie,
  SESSION_COOKIE_NAME,
  type SessionKeyRing,
  type SessionPayloadV1,
  unsealSession,
} from './session.js'

const GITHUB_SETTINGS_URL = 'https://github.com/settings/applications'

type BaseDependencies = {
  env?: ServerEnvironment
  now?: () => number
  createRequestId?: () => string
  loadSessionKeys?: (env: ServerEnvironment) => SessionKeyRing
}

type AuthStartDependencies = BaseDependencies & {
  createRandomValue?: () => string
}

type AuthCallbackDependencies = BaseDependencies & {
  exchangeCode?: (options: {
    code: string
    codeVerifier: string
    redirectUri: string
    env: ServerEnvironment
  }) => Promise<GitHubTokenExchange>
  getUser?: (accessToken: string) => Promise<GitHubUser>
}

type DisconnectDependencies = BaseDependencies & {
  revokeToken?: (accessToken: string, env: ServerEnvironment) => Promise<boolean>
}

function appendCookies(response: Response, cookies: readonly string[]): Response {
  for (const cookie of cookies) response.headers.append('Set-Cookie', cookie)
  return response
}

function redirect(location: string, status: 302 | 303, cookies: readonly string[]): Response {
  return appendCookies(
    new Response(null, {
      status,
      headers: {
        'Cache-Control': 'no-store',
        Location: location,
      },
    }),
    cookies,
  )
}

function callbackLocation(
  origin: string,
  result: 'connected' | 'error',
  code?: string,
): string {
  const location = new URL('/', origin)
  location.searchParams.set('auth', result)
  if (code) location.searchParams.set('code', code)
  return location.toString()
}

function callbackError(origin: string, code: string): Response {
  return redirect(callbackLocation(origin, 'error', code), 303, [
    clearOAuthStateCookie(),
  ])
}

function matchesState(expected: string, actual: string | null): boolean {
  if (!actual || !/^[A-Za-z0-9_-]{43}$/.test(actual)) return false
  const expectedBytes = Buffer.from(expected, 'ascii')
  const actualBytes = Buffer.from(actual, 'ascii')
  return (
    expectedBytes.byteLength === actualBytes.byteLength &&
    timingSafeEqual(expectedBytes, actualBytes)
  )
}

function clearedAuthCookies(): string[] {
  return [
    clearSessionCookie(),
    clearOAuthStateCookie(),
    clearCsrfCookie(),
  ]
}

function csrfFailure(request: Request, requestId: string): Response | null {
  const validation = validateStateChangingRequest(request)
  if (validation.ok === true) return null
  return apiError(
    403,
    validation.code,
    'The authentication request could not be verified.',
    false,
    requestId,
  )
}

export async function handleAuthStartRequest(
  request: Request,
  dependencies: AuthStartDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId)

  const url = new URL(request.url)
  const returnPath = url.searchParams.get('returnPath') ?? '/'
  if (returnPath !== '/') {
    return apiError(
      400,
      'INVALID_RETURN_PATH',
      'The requested return path is not allowed.',
      false,
      requestId,
      { stage: 'auth-start' },
    )
  }

  const clientId = env.GITHUB_APP_CLIENT_ID
  if (!clientId) {
    return apiError(
      500,
      'AUTH_START_FAILED',
      'GitHub sign-in could not be started.',
      true,
      requestId,
      { stage: 'auth-start' },
    )
  }

  try {
    const now = (dependencies.now ?? Date.now)()
    const createRandom = dependencies.createRandomValue ?? createOAuthRandomValue
    const state = createRandom()
    const codeVerifier = createRandom()
    const payload: OAuthStatePayloadV1 = {
      version: 1,
      state,
      codeVerifier,
      originKey: gate.origin.key,
      returnPath: '/',
      issuedAt: now,
      expiresAt: now + OAUTH_STATE_MAX_AGE_SECONDS * 1_000,
    }
    const keys = (dependencies.loadSessionKeys ?? loadSessionKeyRing)(env)
    const sealed = await sealOAuthState(payload, keys)
    const authorizeUrl = buildGitHubAuthorizationUrl({
      clientId,
      redirectUri: gate.origin.callbackUrl,
      state,
      codeChallenge: createPkceChallenge(codeVerifier),
    })
    return redirect(authorizeUrl, 302, [oauthStateCookie(sealed)])
  } catch {
    return apiError(
      500,
      'AUTH_START_FAILED',
      'GitHub sign-in could not be started.',
      true,
      requestId,
      { stage: 'auth-start' },
    )
  }
}

export async function handleAuthCallbackRequest(
  request: Request,
  dependencies: AuthCallbackDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId)

  const url = new URL(request.url)
  const stateValue = parseCookies(request.headers.get('Cookie')).get(
    OAUTH_STATE_COOKIE_NAME,
  )
  if (!stateValue) return callbackError(gate.origin.origin, 'state_invalid')

  let oauthState: OAuthStatePayloadV1
  try {
    const keys = (dependencies.loadSessionKeys ?? loadSessionKeyRing)(env)
    oauthState = await unsealOAuthState(stateValue, keys)
  } catch {
    return callbackError(gate.origin.origin, 'state_invalid')
  }

  const now = (dependencies.now ?? Date.now)()
  if (
    oauthState.expiresAt <= now ||
    oauthState.originKey !== gate.origin.key ||
    oauthState.returnPath !== '/'
  ) {
    return callbackError(
      gate.origin.origin,
      oauthState.originKey !== gate.origin.key ? 'origin_invalid' : 'state_invalid',
    )
  }
  if (!matchesState(oauthState.state, url.searchParams.get('state'))) {
    return callbackError(gate.origin.origin, 'state_invalid')
  }
  if (url.searchParams.has('error')) {
    return callbackError(gate.origin.origin, 'access_denied')
  }

  const code = url.searchParams.get('code')
  if (!code) return callbackError(gate.origin.origin, 'exchange_failed')

  try {
    const exchange =
      dependencies.exchangeCode ??
      ((options) => exchangeGitHubCode(options))
    const getUser =
      dependencies.getUser ??
      ((accessToken) => getAuthenticatedGitHubUser({ accessToken }))
    const token = await exchange({
      code,
      codeVerifier: oauthState.codeVerifier,
      redirectUri: gate.origin.callbackUrl,
      env,
    })
    const user = await getUser(token.accessToken)
    const payload: SessionPayloadV1 = {
      version: 1,
      user,
      accessToken: token.accessToken,
      accessTokenExpiresAt: now + token.accessTokenExpiresIn * 1_000,
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: now + token.refreshTokenExpiresIn * 1_000,
      issuedAt: now,
    }
    const keys = (dependencies.loadSessionKeys ?? loadSessionKeyRing)(env)
    const sealed = await sealSession(payload, keys)
    const csrfToken = createCsrfToken()
    return redirect(callbackLocation(gate.origin.origin, 'connected'), 303, [
      clearOAuthStateCookie(),
      sessionCookie(sealed, payload, now),
      csrfCookie(csrfToken),
    ])
  } catch {
    return callbackError(gate.origin.origin, 'exchange_failed')
  }
}

export function handleSignOutRequest(
  request: Request,
  dependencies: BaseDependencies = {},
): Response {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId)
  const failure = csrfFailure(request, requestId)
  if (failure) return failure
  return appendCookies(
    apiSuccess({ signedOut: true }, requestId),
    clearedAuthCookies(),
  )
}

export async function handleDisconnectRequest(
  request: Request,
  dependencies: DisconnectDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId)
  const failure = csrfFailure(request, requestId)
  if (failure) return failure

  const sessionValue = parseCookies(request.headers.get('Cookie')).get(
    SESSION_COOKIE_NAME,
  )
  if (!sessionValue) {
    return appendCookies(
      apiError(
        401,
        'AUTH_REQUIRED',
        'GitHub sign-in is required.',
        false,
        requestId,
      ),
      clearedAuthCookies(),
    )
  }

  let revoked = false
  try {
    const keys = (dependencies.loadSessionKeys ?? loadSessionKeyRing)(env)
    const { payload } = await unsealSession(sessionValue, keys)
    const revoke =
      dependencies.revokeToken ??
      ((accessToken, currentEnv) =>
        revokeGitHubToken({ accessToken, env: currentEnv }))
    revoked = await revoke(payload.accessToken, env)
  } catch {
    revoked = false
  }

  return appendCookies(
    apiSuccess(
      {
        disconnected: true,
        revocation: revoked ? ('succeeded' as const) : ('failed' as const),
        ...(!revoked ? { githubSettingsUrl: GITHUB_SETTINGS_URL } : {}),
      },
      requestId,
    ),
    clearedAuthCookies(),
  )
}
