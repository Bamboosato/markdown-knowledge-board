import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import type { ServerEnvironment } from './environment.js'
import type { SessionPayloadV1 } from './session.js'

export const GITHUB_API_VERSION = '2026-03-10'
export const GITHUB_REST_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': GITHUB_API_VERSION,
} as const

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_API_URL = 'https://api.github.com'

export class GitHubConfigurationError extends Error {
  constructor() {
    super('GitHub server configuration is unavailable.')
    this.name = 'GitHubConfigurationError'
  }
}

export class GitHubRefreshTransientError extends Error {
  readonly kind: 'timeout' | 'unavailable'

  constructor(kind: GitHubRefreshTransientError['kind']) {
    super('GitHub token refresh is temporarily unavailable.')
    this.name = 'GitHubRefreshTransientError'
    this.kind = kind
  }
}

export class GitHubOAuthError extends Error {
  readonly kind: 'configuration' | 'timeout' | 'rejected' | 'unavailable'

  constructor(kind: GitHubOAuthError['kind']) {
    super('GitHub OAuth request failed.')
    this.name = 'GitHubOAuthError'
    this.kind = kind
  }
}

export type GitHubTokenExchange = {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresIn: number
}

export type GitHubUser = {
  id: number
  login: string
  avatarUrl: string
}

type RefreshResponse = {
  access_token: string
  expires_in: number
  refresh_token: string
  refresh_token_expires_in: number
}

function isRefreshResponse(value: unknown): value is RefreshResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return (
    typeof response.access_token === 'string' &&
    response.access_token.length > 0 &&
    Number.isSafeInteger(response.expires_in) &&
    (response.expires_in as number) > 0 &&
    typeof response.refresh_token === 'string' &&
    response.refresh_token.length > 0 &&
    Number.isSafeInteger(response.refresh_token_expires_in) &&
    (response.refresh_token_expires_in as number) > 0
  )
}

function oauthErrorKind(error: unknown): GitHubOAuthError['kind'] {
  return error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? 'timeout'
    : 'unavailable'
}

export function createOAuthRandomValue(): string {
  return randomBytes(32).toString('base64url')
}

export function createPkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
}

export function buildGitHubAuthorizationUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const url = new URL(GITHUB_AUTHORIZE_URL)
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('state', options.state)
  url.searchParams.set('code_challenge', options.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function exchangeGitHubCode(options: {
  code: string
  codeVerifier: string
  redirectUri: string
  env: ServerEnvironment
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<GitHubTokenExchange> {
  const clientId = options.env.GITHUB_APP_CLIENT_ID
  const clientSecret = options.env.GITHUB_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new GitHubOAuthError('configuration')

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  })

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
  } catch (error) {
    throw new GitHubOAuthError(oauthErrorKind(error))
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GitHubOAuthError('unavailable')
  }
  if (!response.ok) throw new GitHubOAuthError('rejected')

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new GitHubOAuthError('unavailable')
  }
  if (!isRefreshResponse(data)) throw new GitHubOAuthError('rejected')

  return {
    accessToken: data.access_token,
    accessTokenExpiresIn: data.expires_in,
    refreshToken: data.refresh_token,
    refreshTokenExpiresIn: data.refresh_token_expires_in,
  }
}

export async function getAuthenticatedGitHubUser(options: {
  accessToken: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<GitHubUser> {
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(`${GITHUB_API_URL}/user`, {
      headers: {
        ...GITHUB_REST_HEADERS,
        Authorization: `Bearer ${options.accessToken}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
  } catch (error) {
    throw new GitHubOAuthError(oauthErrorKind(error))
  }
  if (!response.ok) {
    throw new GitHubOAuthError(
      response.status === 429 || response.status >= 500
        ? 'unavailable'
        : 'rejected',
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new GitHubOAuthError('unavailable')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new GitHubOAuthError('rejected')
  }
  const user = data as Record<string, unknown>
  if (
    !Number.isSafeInteger(user.id) ||
    (user.id as number) <= 0 ||
    typeof user.login !== 'string' ||
    user.login.length === 0 ||
    user.login.length > 100 ||
    typeof user.avatar_url !== 'string' ||
    user.avatar_url.length > 2_048
  ) {
    throw new GitHubOAuthError('rejected')
  }
  return {
    id: user.id as number,
    login: user.login,
    avatarUrl: user.avatar_url,
  }
}

export async function revokeGitHubToken(options: {
  accessToken: string
  env: ServerEnvironment
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<boolean> {
  const clientId = options.env.GITHUB_APP_CLIENT_ID
  const clientSecret = options.env.GITHUB_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) return false

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${GITHUB_API_URL}/applications/${encodeURIComponent(clientId)}/token`,
      {
        method: 'DELETE',
        headers: {
          ...GITHUB_REST_HEADERS,
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: options.accessToken }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      },
    )
    return response.status === 204
  } catch {
    return false
  }
}

export async function refreshGitHubSession(
  current: SessionPayloadV1,
  options: {
    env: ServerEnvironment
    now: number
    fetchImpl?: typeof fetch
    timeoutMs?: number
  },
): Promise<SessionPayloadV1 | null> {
  const clientId = options.env.GITHUB_APP_CLIENT_ID
  const clientSecret = options.env.GITHUB_APP_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new GitHubConfigurationError()
  if (current.refreshTokenExpiresAt <= options.now) return null

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  })

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
  } catch (error) {
    const kind = error instanceof Error && error.name === 'TimeoutError'
      ? 'timeout'
      : 'unavailable'
    throw new GitHubRefreshTransientError(kind)
  }

  if (response.status === 429 || response.status >= 500) {
    throw new GitHubRefreshTransientError('unavailable')
  }
  if (!response.ok) return null

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new GitHubRefreshTransientError('unavailable')
  }
  if (!isRefreshResponse(data)) {
    throw new GitHubRefreshTransientError('unavailable')
  }

  return {
    ...current,
    accessToken: data.access_token,
    accessTokenExpiresAt: options.now + data.expires_in * 1_000,
    refreshToken: data.refresh_token,
    refreshTokenExpiresAt:
      options.now + data.refresh_token_expires_in * 1_000,
    issuedAt: options.now,
  }
}
