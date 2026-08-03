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

export type CloudBackupMetadata = {
  gistId: string
  revision: string
  updatedAt: string
  htmlUrl: string
  encryptedSize: number
}

export type CloudBackupResolution =
  | { status: 'none' }
  | { status: 'selected'; backup: CloudBackupMetadata }
  | { status: 'selection-required'; candidates: CloudBackupMetadata[] }

export type CloudBackupWriteData = {
  gistId: string
  revision: string
  updatedAt: string
  encryptedSize: number
  sha256: string
}

type ApiSuccess<T> = {
  ok: true
  data: T
  requestId: string
}

type ApiFailure = {
  ok: false
  error: {
    code: string
    message: string
    retryable: boolean
    stage?: string
    retryAfterSeconds?: number
  }
  requestId: string
}

export class CloudApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly retryable: boolean
  readonly stage?: string
  readonly retryAfterSeconds?: number

  constructor(
    code: string,
    message: string,
    options: {
      requestId?: string
      retryable?: boolean
      stage?: string
      retryAfterSeconds?: number
    } = {},
  ) {
    super(message)
    this.name = 'CloudApiError'
    this.code = code
    this.requestId = options.requestId
    this.retryable = options.retryable ?? false
    this.stage = options.stage
    this.retryAfterSeconds = options.retryAfterSeconds
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
      redirect: 'error',
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
        stage: envelope.error.stage,
        retryAfterSeconds: envelope.error.retryAfterSeconds,
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

export function discoverCloudBackups(
  cachedGistId?: string,
): Promise<CloudBackupResolution> {
  const query = cachedGistId
    ? `?gistId=${encodeURIComponent(cachedGistId)}`
    : ''
  return apiRequest<CloudBackupResolution>(`/api/cloud-backups${query}`, {}, 15_000)
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export async function sha256Base64Url(content: Uint8Array): Promise<string> {
  const copy = new Uint8Array(content)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return encodeBase64Url(new Uint8Array(digest))
}

export async function uploadCloudBackup(options: {
  content: Uint8Array
  csrfToken: string
  current?: Pick<CloudBackupMetadata, 'gistId' | 'revision'>
}): Promise<CloudBackupWriteData> {
  const sha256 = await sha256Base64Url(options.content)
  const isUpdate = options.current !== undefined
  const path = isUpdate
    ? `/api/cloud-backups/update?gistId=${encodeURIComponent(options.current!.gistId)}`
    : '/api/cloud-backups'
  return apiRequest<CloudBackupWriteData>(
    path,
    {
      method: isUpdate ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/vnd.mkb.encrypted-backup+json',
        'X-CSRF-Token': options.csrfToken,
        'X-MKB-Operation-Id': crypto.randomUUID(),
        'X-MKB-Content-SHA256': sha256,
        ...(isUpdate
          ? { 'X-MKB-Expected-Revision': options.current!.revision }
          : {}),
      },
      body: new Uint8Array(options.content).buffer,
    },
    30_000,
  )
}
