import { parseCookies } from './cookies.js'
import { getOrCreateCsrfToken } from './csrf.js'
import {
  requireProductionCloudEnvironment,
  type ServerEnvironment,
} from './environment.js'
import {
  GitHubConfigurationError,
  GitHubRefreshTransientError,
  refreshGitHubSession,
} from './github.js'
import {
  apiError,
  apiSuccess,
  createRequestId,
  methodNotAllowed,
} from './http.js'
import {
  clearSessionCookie,
  loadSessionKeyRing,
  sealSession,
  sessionCookie,
  SessionError,
  SESSION_COOKIE_NAME,
  type SessionKeyRing,
  type SessionPayloadV1,
  unsealSession,
} from './session.js'

const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1_000

export type SessionResponse =
  | { status: 'signed-out'; csrfToken: string }
  | {
      status: 'signed-in'
      user: SessionPayloadV1['user']
      accessTokenExpiresAt: string
      csrfToken: string
    }
  | { status: 'reauthorization-required'; csrfToken: string }

type AuthSessionDependencies = {
  env?: ServerEnvironment
  now?: () => number
  createRequestId?: () => string
  loadSessionKeys?: (env: ServerEnvironment) => SessionKeyRing
  refreshSession?: (
    current: SessionPayloadV1,
    context: { env: ServerEnvironment; now: number },
  ) => Promise<SessionPayloadV1 | null>
}

function withCookies(response: Response, cookies: readonly (string | null)[]): Response {
  for (const cookie of cookies) {
    if (cookie) response.headers.append('Set-Cookie', cookie)
  }
  return response
}

export async function handleAuthSessionRequest(
  request: Request,
  dependencies: AuthSessionDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId)

  const csrf = getOrCreateCsrfToken(request)
  const sessionValue = parseCookies(request.headers.get('Cookie')).get(
    SESSION_COOKIE_NAME,
  )
  if (!sessionValue) {
    return withCookies(
      apiSuccess<SessionResponse>(
        { status: 'signed-out', csrfToken: csrf.token },
        requestId,
      ),
      [csrf.setCookie],
    )
  }

  const now = (dependencies.now ?? Date.now)()
  try {
    const keyRing = (dependencies.loadSessionKeys ?? loadSessionKeyRing)(env)
    const unsealed = await unsealSession(sessionValue, keyRing)
    let payload = unsealed.payload

    if (payload.refreshTokenExpiresAt <= now) {
      return withCookies(
        apiSuccess<SessionResponse>(
          { status: 'reauthorization-required', csrfToken: csrf.token },
          requestId,
        ),
        [csrf.setCookie, clearSessionCookie()],
      )
    }

    let replaceSession = unsealed.needsRotation
    if (payload.accessTokenExpiresAt - now <= ACCESS_TOKEN_REFRESH_WINDOW_MS) {
      const refresh =
        dependencies.refreshSession ??
        ((current, context) =>
          refreshGitHubSession(current, {
            env: context.env,
            now: context.now,
          }))
      const refreshed = await refresh(payload, { env, now })
      if (!refreshed) {
        return withCookies(
          apiSuccess<SessionResponse>(
            { status: 'reauthorization-required', csrfToken: csrf.token },
            requestId,
          ),
          [csrf.setCookie, clearSessionCookie()],
        )
      }
      payload = refreshed
      replaceSession = true
    }

    let replacementCookie: string | null = null
    if (replaceSession) {
      const sealed = await sealSession(payload, keyRing)
      replacementCookie = sessionCookie(sealed, payload, now)
    }

    return withCookies(
      apiSuccess<SessionResponse>(
        {
          status: 'signed-in',
          user: payload.user,
          accessTokenExpiresAt: new Date(payload.accessTokenExpiresAt).toISOString(),
          csrfToken: csrf.token,
        },
        requestId,
      ),
      [csrf.setCookie, replacementCookie],
    )
  } catch (error) {
    if (error instanceof SessionError && error.code === 'SESSION_INVALID') {
      return withCookies(
        apiSuccess<SessionResponse>(
          { status: 'reauthorization-required', csrfToken: csrf.token },
          requestId,
        ),
        [csrf.setCookie, clearSessionCookie()],
      )
    }

    if (error instanceof GitHubRefreshTransientError) {
      return withCookies(
        apiError(
          error.kind === 'timeout' ? 504 : 503,
          error.kind === 'timeout'
            ? 'SESSION_CHECK_TIMEOUT'
            : 'SESSION_CHECK_UNAVAILABLE',
          'GitHub session is temporarily unavailable.',
          true,
          requestId,
          { stage: 'auth-check' },
        ),
        [csrf.setCookie],
      )
    }

    const code =
      error instanceof SessionError && error.code === 'SESSION_TOO_LARGE'
        ? 'SESSION_TOO_LARGE'
        : error instanceof GitHubConfigurationError
          ? 'SESSION_REFRESH_UNAVAILABLE'
          : 'SESSION_UNAVAILABLE'
    return withCookies(
      apiError(
        500,
        code,
        'GitHub session could not be checked.',
        true,
        requestId,
        { stage: 'auth-check' },
      ),
      [csrf.setCookie],
    )
  }
}
