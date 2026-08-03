import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { GITHUB_REST_HEADERS } from './github.js'

export const BACKUP_GIST_DESCRIPTION =
  'Markdown Knowledge Board encrypted backup'
export const BACKUP_GIST_FILENAME =
  'markdown-knowledge-board.backup.enc.json'
export const GIST_DISCOVERY_MAX_PAGES = 10

const GITHUB_API_ORIGIN = 'https://api.github.com'
const RAW_GIST_HOST = 'gist.githubusercontent.com'

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

export type VerifiedBackupGist = {
  metadata: CloudBackupMetadata
  content: string
  sha256: string
}

type GistFile = {
  size: number
  truncated: boolean
  content?: string
  rawUrl?: string
}

type ParsedGist = {
  id: string
  description: string
  ownerId: number
  updatedAt: string
  htmlUrl: string
  revision?: string
  file?: GistFile
}

export class GistApiError extends Error {
  readonly kind:
    | 'not-found'
    | 'permission'
    | 'rate-limit'
    | 'timeout'
    | 'unavailable'
    | 'invalid-response'
    | 'discovery-incomplete'
  readonly retryAfterSeconds?: number

  constructor(
    kind: GistApiError['kind'],
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(`GIST_${kind.toUpperCase().replaceAll('-', '_')}`)
    this.name = 'GistApiError'
    this.kind = kind
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isGistId(value: string): boolean {
  return /^[A-Fa-f0-9]{1,64}$/.test(value)
}

export function validateGistId(value: string): string {
  if (!isGistId(value)) throw new GistApiError('invalid-response')
  return value
}

function parsePositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null
}

function revisionFromEtag(value: string | null): string | undefined {
  if (!value) return undefined
  const match = value.match(/^(?:W\/)?"([A-Fa-f0-9]{40,64})"$/)
  return match?.[1]
}

function parseGist(value: unknown, responseRevision?: string): ParsedGist {
  if (!isRecord(value)) throw new GistApiError('invalid-response')
  const description = value.description
  const owner = value.owner
  const files = value.files
  if (
    typeof value.id !== 'string' ||
    !isGistId(value.id) ||
    (typeof description !== 'string' && description !== null) ||
    !isRecord(owner) ||
    !Number.isSafeInteger(owner.id) ||
    (owner.id as number) <= 0 ||
    typeof value.updated_at !== 'string' ||
    Number.isNaN(Date.parse(value.updated_at)) ||
    typeof value.html_url !== 'string'
  ) {
    throw new GistApiError('invalid-response')
  }
  let htmlUrl: URL
  try {
    htmlUrl = new URL(value.html_url)
  } catch {
    throw new GistApiError('invalid-response')
  }
  if (
    htmlUrl.origin !== 'https://gist.github.com' ||
    htmlUrl.username !== '' ||
    htmlUrl.password !== ''
  ) {
    throw new GistApiError('invalid-response')
  }

  let revision = responseRevision
  if (!revision && Array.isArray(value.history) && value.history.length > 0) {
    const latest = value.history[0]
    if (
      !isRecord(latest) ||
      typeof latest.version !== 'string' ||
      !/^[A-Fa-f0-9]{40,64}$/.test(latest.version)
    ) {
      throw new GistApiError('invalid-response')
    }
    revision = latest.version
  }

  let file: GistFile | undefined
  if (isRecord(files) && isRecord(files[BACKUP_GIST_FILENAME])) {
    const rawFile = files[BACKUP_GIST_FILENAME]
    const size = parsePositiveInteger(rawFile.size)
    if (
      size === null ||
      (rawFile.truncated !== undefined &&
        typeof rawFile.truncated !== 'boolean')
    ) {
      throw new GistApiError('invalid-response')
    }
    if (
      rawFile.content !== undefined &&
      typeof rawFile.content !== 'string'
    ) {
      throw new GistApiError('invalid-response')
    }
    if (rawFile.raw_url !== undefined && typeof rawFile.raw_url !== 'string') {
      throw new GistApiError('invalid-response')
    }
    file = {
      size,
      truncated: rawFile.truncated === true,
      ...(typeof rawFile.content === 'string'
        ? { content: rawFile.content }
        : {}),
      ...(typeof rawFile.raw_url === 'string'
        ? { rawUrl: rawFile.raw_url }
        : {}),
    }
  }

  return {
    id: value.id,
    description: typeof description === 'string' ? description : '',
    ownerId: owner.id as number,
    updatedAt: new Date(value.updated_at).toISOString(),
    htmlUrl: htmlUrl.toString(),
    ...(revision ? { revision } : {}),
    ...(file ? { file } : {}),
  }
}

function isBackupGist(gist: ParsedGist, userId: number): boolean {
  return (
    gist.ownerId === userId &&
    gist.description === BACKUP_GIST_DESCRIPTION &&
    gist.file !== undefined
  )
}

function metadataFromGist(gist: ParsedGist): CloudBackupMetadata {
  if (!gist.revision || !gist.file) throw new GistApiError('invalid-response')
  return {
    gistId: gist.id,
    revision: gist.revision,
    updatedAt: gist.updatedAt,
    htmlUrl: gist.htmlUrl,
    encryptedSize: gist.file.size,
  }
}

function githubHeaders(accessToken: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  for (const [name, value] of Object.entries(GITHUB_REST_HEADERS)) {
    headers.set(name, value)
  }
  headers.set('Authorization', `Bearer ${accessToken}`)
  return headers
}

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('Retry-After'))
  if (Number.isSafeInteger(seconds) && seconds >= 0) return seconds
  const reset = Number(response.headers.get('X-RateLimit-Reset'))
  if (Number.isSafeInteger(reset) && reset > 0) {
    return Math.max(0, reset - Math.floor(Date.now() / 1_000))
  }
  return undefined
}

async function githubRequest(
  url: string,
  accessToken: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH'
    body?: string
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {},
): Promise<Response> {
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: options.method ?? 'GET',
      headers: githubHeaders(
        accessToken,
        options.body ? { 'Content-Type': 'application/json' } : undefined,
      ),
      ...(options.body ? { body: options.body } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
  } catch (error) {
    throw new GistApiError(
      error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'timeout'
        : 'unavailable',
    )
  }

  if (response.ok) return response
  if (response.status === 404) throw new GistApiError('not-found')
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get('X-RateLimit-Remaining') === '0')
  ) {
    throw new GistApiError('rate-limit', {
      retryAfterSeconds: retryAfter(response),
    })
  }
  if (response.status === 401 || response.status === 403) {
    throw new GistApiError('permission')
  }
  if (response.status >= 500) throw new GistApiError('unavailable')
  throw new GistApiError('invalid-response')
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new GistApiError('invalid-response')
  }
}

export async function getGist(
  gistId: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ParsedGist> {
  validateGistId(gistId)
  const response = await githubRequest(
    `${GITHUB_API_ORIGIN}/gists/${gistId}`,
    accessToken,
    options,
  )
  return parseGist(
    await responseJson(response),
    revisionFromEtag(response.headers.get('ETag')),
  )
}

function nextPageFromLink(link: string | null, currentPage: number): number | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/)
    if (!match || match[2] !== 'next') continue
    let url: URL
    try {
      url = new URL(match[1] ?? '')
    } catch {
      throw new GistApiError('invalid-response')
    }
    const page = Number(url.searchParams.get('page'))
    if (
      url.origin !== GITHUB_API_ORIGIN ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/gists' ||
      url.searchParams.get('per_page') !== '100' ||
      !Number.isSafeInteger(page) ||
      page !== currentPage + 1
    ) {
      throw new GistApiError('invalid-response')
    }
    return page
  }
  return null
}

async function listBackupGistIds(
  accessToken: string,
  userId: number,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string[]> {
  const ids: string[] = []
  let page = 1
  while (page <= GIST_DISCOVERY_MAX_PAGES) {
    const response = await githubRequest(
      `${GITHUB_API_ORIGIN}/gists?per_page=100&page=${page}`,
      accessToken,
      options,
    )
    const value = await responseJson(response)
    if (!Array.isArray(value)) throw new GistApiError('invalid-response')
    for (const item of value) {
      const gist = parseGist(item)
      if (isBackupGist(gist, userId) && !ids.includes(gist.id)) ids.push(gist.id)
    }
    const nextPage = nextPageFromLink(response.headers.get('Link'), page)
    if (nextPage === null) return ids
    if (page === GIST_DISCOVERY_MAX_PAGES) {
      throw new GistApiError('discovery-incomplete')
    }
    page = nextPage
  }
  return ids
}

export async function resolveCloudBackup(
  accessToken: string,
  userId: number,
  cachedGistId?: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CloudBackupResolution> {
  if (cachedGistId) {
    try {
      const cached = await getGist(cachedGistId, accessToken, options)
      if (isBackupGist(cached, userId)) {
        return { status: 'selected', backup: metadataFromGist(cached) }
      }
    } catch (error) {
      if (!(error instanceof GistApiError) || error.kind !== 'not-found') {
        throw error
      }
    }
  }

  const ids = await listBackupGistIds(accessToken, userId, options)
  const candidates: CloudBackupMetadata[] = []
  for (const id of ids) {
    const gist = await getGist(id, accessToken, options)
    if (isBackupGist(gist, userId)) candidates.push(metadataFromGist(gist))
  }
  if (candidates.length === 0) return { status: 'none' }
  if (candidates.length === 1) {
    return { status: 'selected', backup: candidates[0]! }
  }
  return { status: 'selection-required', candidates }
}

function validateRawUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new GistApiError('invalid-response')
  }
  if (
    url.origin !== `https://${RAW_GIST_HOST}` ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new GistApiError('invalid-response')
  }
  return url.toString()
}

async function rawGistRequest(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Response> {
  let currentUrl = validateRawUrl(url)
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    let response: Response
    try {
      response = await (options.fetchImpl ?? fetch)(currentUrl, {
        headers: { Accept: 'application/octet-stream' },
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      })
    } catch (error) {
      throw new GistApiError(
        error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'timeout'
          : 'unavailable',
      )
    }
    if (response.ok) return response
    if (response.status >= 300 && response.status < 400) {
      if (redirects === 2) throw new GistApiError('invalid-response')
      const location = response.headers.get('Location')
      if (!location) throw new GistApiError('invalid-response')
      try {
        currentUrl = validateRawUrl(new URL(location, currentUrl).toString())
      } catch {
        throw new GistApiError('invalid-response')
      }
      continue
    }
    if (response.status === 404) throw new GistApiError('not-found')
    if (response.status === 429) {
      throw new GistApiError('rate-limit', {
        retryAfterSeconds: retryAfter(response),
      })
    }
    if (response.status >= 500) throw new GistApiError('unavailable')
    throw new GistApiError('invalid-response')
  }
  throw new GistApiError('invalid-response')
}

async function readTextWithLimit(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      await reader.cancel().catch(() => undefined)
      throw new GistApiError('invalid-response')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new GistApiError('invalid-response')
  }
}

export function sha256Base64Url(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('base64url')
}

export async function getVerifiedBackupGist(
  gistId: string,
  accessToken: string,
  userId: number,
  maxBytes: number,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<VerifiedBackupGist> {
  const gist = await getGist(gistId, accessToken, options)
  if (!isBackupGist(gist, userId) || !gist.file) {
    throw new GistApiError('not-found')
  }
  let content: string
  if (gist.file.truncated) {
    if (!gist.file.rawUrl) throw new GistApiError('invalid-response')
    const response = await rawGistRequest(
      validateRawUrl(gist.file.rawUrl),
      options,
    )
    content = await readTextWithLimit(response, maxBytes)
  } else if (gist.file.content !== undefined) {
    content = gist.file.content
  } else {
    throw new GistApiError('invalid-response')
  }
  const size = Buffer.byteLength(content, 'utf8')
  if (size < 1 || size > maxBytes || size !== gist.file.size) {
    throw new GistApiError('invalid-response')
  }
  return {
    metadata: metadataFromGist(gist),
    content,
    sha256: sha256Base64Url(content),
  }
}

export async function createBackupGist(
  content: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const response = await githubRequest(`${GITHUB_API_ORIGIN}/gists`, accessToken, {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      description: BACKUP_GIST_DESCRIPTION,
      public: false,
      files: { [BACKUP_GIST_FILENAME]: { content } },
    }),
  })
  const gist = parseGist(await responseJson(response))
  return gist.id
}

export async function updateBackupGist(
  gistId: string,
  content: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  validateGistId(gistId)
  await githubRequest(`${GITHUB_API_ORIGIN}/gists/${gistId}`, accessToken, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify({
      files: { [BACKUP_GIST_FILENAME]: { content } },
    }),
  })
}
