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

export type CloudBackupContent = {
  content: Uint8Array
  gistId: string
  revision: string
  updatedAt: string
  sha256: string
}

const ENCRYPTED_CONTENT_TYPE = 'application/vnd.mkb.encrypted-backup+json'
const MAX_ENCRYPTED_BACKUP_BYTES = 4_500_000
const GIST_ID_PATTERN = /^[A-Fa-f0-9]{1,64}$/
const REVISION_PATTERN = /^[A-Fa-f0-9]{40,64}$/
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/

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

function errorFromApiBody(body: unknown): CloudApiError | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const envelope = body as Partial<ApiFailure>
  if (envelope.ok !== false || !envelope.error) return null
  return new CloudApiError(envelope.error.code, envelope.error.message, {
    requestId: envelope.requestId,
    retryable: envelope.error.retryable,
    stage: envelope.error.stage,
    retryAfterSeconds: envelope.error.retryAfterSeconds,
  })
}

function invalidResponseError(): CloudApiError {
  return new CloudApiError(
    'INVALID_RESPONSE',
    'The GitHub response could not be read.',
    { retryable: true },
  )
}

function networkError(error: unknown): CloudApiError {
  if (error instanceof CloudApiError) return error
  if (error instanceof Error && error.name === 'AbortError') {
    return new CloudApiError(
      'CLIENT_TIMEOUT',
      'GitHub did not respond in time.',
      { retryable: true },
    )
  }
  return new CloudApiError(
    navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE',
    navigator.onLine ? 'GitHub is temporarily unavailable.' : 'You are offline.',
    { retryable: true },
  )
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
      throw invalidResponseError()
    }
    const envelope = body as ApiSuccess<T> | ApiFailure
    if (envelope.ok === true) return envelope.data
    const apiError = errorFromApiBody(envelope)
    if (apiError) throw apiError
    throw invalidResponseError()
  } catch (error) {
    throw networkError(error)
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getGitHubSession(): Promise<SessionData> {
  return apiRequest<SessionData>('/api/auth/session')
}

export function getCsrfToken(): Promise<{ csrfToken: string }> {
  return apiRequest<{ csrfToken: string }>('/api/auth/csrf')
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

async function readBytesWithLimit(response: Response): Promise<Uint8Array> {
  if (!response.body) throw invalidResponseError()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > MAX_ENCRYPTED_BACKUP_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new CloudApiError(
        'PAYLOAD_TOO_LARGE',
        'The encrypted backup exceeds 4,500,000 bytes.',
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function downloadCloudBackup(
  gistId: string,
): Promise<CloudBackupContent> {
  if (!GIST_ID_PATTERN.test(gistId)) {
    throw new CloudApiError('INVALID_GIST_ID', 'The cloud backup ID is invalid.')
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(
      `/api/cloud-backups/content?gistId=${encodeURIComponent(gistId)}`,
      {
        credentials: 'same-origin',
        redirect: 'error',
        headers: { Accept: ENCRYPTED_CONTENT_TYPE },
        signal: controller.signal,
      },
    )
    if (response.headers.get('Content-Type') !== ENCRYPTED_CONTENT_TYPE) {
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw invalidResponseError()
      }
      throw errorFromApiBody(body) ?? invalidResponseError()
    }

    const contentLength = Number(response.headers.get('Content-Length'))
    const responseGistId = response.headers.get('X-MKB-Gist-Id') ?? ''
    const revision = response.headers.get('X-MKB-Revision') ?? ''
    const updatedAt = response.headers.get('X-MKB-Gist-Updated-At') ?? ''
    const expectedSha256 = response.headers.get('X-MKB-Content-SHA256') ?? ''
    if (
      !response.ok ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > MAX_ENCRYPTED_BACKUP_BYTES ||
      responseGistId !== gistId ||
      !REVISION_PATTERN.test(revision) ||
      Number.isNaN(Date.parse(updatedAt)) ||
      !SHA256_PATTERN.test(expectedSha256)
    ) {
      throw invalidResponseError()
    }

    const content = await readBytesWithLimit(response)
    if (content.byteLength !== contentLength) throw invalidResponseError()
    const actualSha256 = await sha256Base64Url(content)
    if (actualSha256 !== expectedSha256) {
      throw new CloudApiError(
        'CONTENT_SHA256_MISMATCH',
        'The downloaded cloud backup failed integrity verification.',
      )
    }
    return {
      content,
      gistId: responseGistId,
      revision,
      updatedAt: new Date(updatedAt).toISOString(),
      sha256: actualSha256,
    }
  } catch (error) {
    throw networkError(error)
  } finally {
    window.clearTimeout(timeout)
  }
}
