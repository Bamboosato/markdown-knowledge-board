export type GitHubUser = {
  id: number
  login: string
  avatarUrl: string
}

export type SessionData =
  | { status: 'signed-out'; csrfToken: string }
  | {
      status: 'signed-in'
      user: GitHubUser
      accessTokenExpiresAt: string
      csrfToken: string
    }
  | { status: 'reauthorization-required'; csrfToken: string }

export type DisconnectData = {
  disconnected: true
  revocation: 'succeeded' | 'failed'
  githubSettingsUrl?: string
}

type ApiSuccess<T> = {
  ok: true
  data: T
  requestId: string
}

type ApiFailure = {
  ok: false
  error: { code: string; message: string; retryable: boolean }
  requestId: string
}

export class CloudApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly retryable: boolean

  constructor(
    code: string,
    message: string,
    options: { requestId?: string; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = 'CloudApiError'
    this.code = code
    this.requestId = options.requestId
    this.retryable = options.retryable ?? false
  }
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    })
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new CloudApiError(
        'INVALID_RESPONSE',
        'The GitHub response could not be read.',
        { retryable: true },
      )
    }
    const envelope = body as ApiSuccess<T> | ApiFailure
    if (envelope.ok === true) return envelope.data
    if (envelope.ok === false && envelope.error) {
      throw new CloudApiError(envelope.error.code, envelope.error.message, {
        requestId: envelope.requestId,
        retryable: envelope.error.retryable,
      })
    }
    throw new CloudApiError(
      'INVALID_RESPONSE',
      'The GitHub response could not be read.',
      { retryable: true },
    )
  } catch (error) {
    if (error instanceof CloudApiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CloudApiError(
        'CLIENT_TIMEOUT',
        'GitHub did not respond in time.',
        { retryable: true },
      )
    }
    throw new CloudApiError(
      navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE',
      navigator.onLine
        ? 'GitHub is temporarily unavailable.'
        : 'You are offline.',
      { retryable: true },
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getGitHubSession(): Promise<SessionData> {
  return apiRequest<SessionData>('/api/auth/session')
}

export function signOutGitHub(csrfToken: string): Promise<{ signedOut: true }> {
  return apiRequest('/api/auth/signout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  })
}

export function disconnectGitHub(csrfToken: string): Promise<DisconnectData> {
  return apiRequest('/api/auth/disconnect', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  })
}
