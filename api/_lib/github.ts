import type { ServerEnvironment } from './environment.js'
import type { SessionPayloadV1 } from './session.js'

export const GITHUB_API_VERSION = '2026-03-10'
export const GITHUB_REST_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': GITHUB_API_VERSION,
} as const

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'

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
