import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import {
  resolveGitHubSession,
  type SessionResolutionDependencies,
} from './authSession.js'
import { BodyReadError, ENCRYPTED_BACKUP_MAX_BYTES, readRawBodyWithLimit } from './body.js'
import { parseCookies } from './cookies.js'
import { validateStateChangingRequest } from './csrf.js'
import {
  requireProductionCloudEnvironment,
  type ServerEnvironment,
} from './environment.js'
import {
  GitHubConfigurationError,
  GitHubRefreshTransientError,
} from './github.js'
import {
  createBackupGist,
  getVerifiedBackupGist,
  GistApiError,
  resolveCloudBackup,
  sha256Base64Url,
  updateBackupGist,
  validateGistId,
  type CloudBackupResolution,
  type VerifiedBackupGist,
} from './gists.js'
import { apiError, apiSuccess, createRequestId, methodNotAllowed, type ApiStage } from './http.js'
import {
  clearSessionCookie,
  SessionError,
  SESSION_COOKIE_NAME,
  type SessionPayloadV1,
} from './session.js'

const ENCRYPTED_CONTENT_TYPE = 'application/vnd.mkb.encrypted-backup+json'
const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/
const REVISION_PATTERN = /^[A-Fa-f0-9]{40,64}$/
const ENVELOPE_KEYS = new Set(['app', 'envelopeVersion', 'crypto', 'ciphertext'])

type BaseDependencies = SessionResolutionDependencies & {
  env?: ServerEnvironment
  createRequestId?: () => string
  resolveBackup?: (
    accessToken: string,
    userId: number,
    cachedGistId?: string,
  ) => Promise<CloudBackupResolution>
  getVerifiedGist?: (
    gistId: string,
    accessToken: string,
    userId: number,
  ) => Promise<VerifiedBackupGist>
  createGist?: (content: string, accessToken: string) => Promise<string>
  updateGist?: (
    gistId: string,
    content: string,
    accessToken: string,
  ) => Promise<void>
}

type Upload = {
  content: string
  sha256: string
  operationId: string
  byteLength: number
}

type CloudBackupWriteResponse = {
  gistId: string
  revision: string
  updatedAt: string
  encryptedSize: number
  sha256: string
}

function appendCookie(response: Response, cookie?: string): Response {
  if (cookie) response.headers.append('Set-Cookie', cookie)
  return response
}

function authError(
  requestId: string,
  code: 'AUTH_REQUIRED' | 'REAUTH_REQUIRED' = 'AUTH_REQUIRED',
  clear = false,
): Response {
  return appendCookie(
    apiError(
      401,
      code,
      code === 'REAUTH_REQUIRED'
        ? 'GitHub sign-in has expired. Sign in again.'
        : 'GitHub sign-in is required.',
      false,
      requestId,
    ),
    clear ? clearSessionCookie() : undefined,
  )
}

async function authenticatedSession(
  request: Request,
  requestId: string,
  env: ServerEnvironment,
  dependencies: BaseDependencies,
): Promise<
  | { ok: true; payload: SessionPayloadV1; replacementCookie: string | null }
  | { ok: false; response: Response }
> {
  const sessionValue = parseCookies(request.headers.get('Cookie')).get(
    SESSION_COOKIE_NAME,
  )
  if (!sessionValue) return { ok: false, response: authError(requestId) }
  try {
    const resolution = await resolveGitHubSession(
      sessionValue,
      env,
      dependencies,
    )
    if (resolution.status === 'reauthorization-required') {
      return {
        ok: false,
        response: authError(requestId, 'REAUTH_REQUIRED', true),
      }
    }
    return {
      ok: true,
      payload: resolution.payload,
      replacementCookie: resolution.replacementCookie,
    }
  } catch (error) {
    if (error instanceof SessionError && error.code === 'SESSION_INVALID') {
      return {
        ok: false,
        response: authError(requestId, 'REAUTH_REQUIRED', true),
      }
    }
    if (error instanceof GitHubRefreshTransientError) {
      return {
        ok: false,
        response: apiError(
          error.kind === 'timeout' ? 504 : 503,
          error.kind === 'timeout'
            ? 'SESSION_CHECK_TIMEOUT'
            : 'SESSION_CHECK_UNAVAILABLE',
          'GitHub session is temporarily unavailable.',
          true,
          requestId,
          { stage: 'auth-check' },
        ),
      }
    }
    const code =
      error instanceof SessionError && error.code === 'SESSION_TOO_LARGE'
        ? 'SESSION_TOO_LARGE'
        : error instanceof GitHubConfigurationError
          ? 'SESSION_REFRESH_UNAVAILABLE'
          : 'SESSION_UNAVAILABLE'
    return {
      ok: false,
      response: apiError(
        500,
        code,
        'GitHub session could not be checked.',
        true,
        requestId,
        { stage: 'auth-check' },
      ),
    }
  }
}

async function withAuthenticatedSession(
  request: Request,
  requestId: string,
  env: ServerEnvironment,
  dependencies: BaseDependencies,
  handle: (payload: SessionPayloadV1) => Promise<Response>,
): Promise<Response> {
  const session = await authenticatedSession(request, requestId, env, dependencies)
  if (session.ok === false) return session.response
  const response = await handle(session.payload)
  return appendCookie(response, session.replacementCookie ?? undefined)
}

function csrfError(request: Request, requestId: string): Response | null {
  const result = validateStateChangingRequest(request)
  if (result.ok === true) return null
  return apiError(
    403,
    result.code,
    'The cloud backup request could not be verified.',
    false,
    requestId,
  )
}

function sameOriginReadError(
  request: Request,
  expectedOrigin: string,
  requestId: string,
): Response | null {
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')
  let suppliedOrigin = origin
  if (!suppliedOrigin && referer) {
    try {
      suppliedOrigin = new URL(referer).origin
    } catch {
      suppliedOrigin = null
    }
  }
  if (
    suppliedOrigin !== expectedOrigin ||
    request.headers.get('Sec-Fetch-Site') !== 'same-origin'
  ) {
    return apiError(
      403,
      'ORIGIN_MISMATCH',
      'The cloud restore request could not be verified.',
      false,
      requestId,
      { stage: 'restore-download' },
    )
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateEnvelopeShape(content: string): void {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('INVALID_ENCRYPTED_ENVELOPE')
  }
  if (!isRecord(value)) throw new Error('INVALID_ENCRYPTED_ENVELOPE')
  const keys = Object.keys(value)
  if (
    keys.length !== ENVELOPE_KEYS.size ||
    keys.some((key) => !ENVELOPE_KEYS.has(key)) ||
    value.app !== 'markdown-knowledge-board' ||
    value.envelopeVersion !== 1 ||
    !isRecord(value.crypto) ||
    typeof value.ciphertext !== 'string' ||
    value.ciphertext.length === 0
  ) {
    throw new Error('INVALID_ENCRYPTED_ENVELOPE')
  }
}

function constantTimeMatches(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'ascii')
  const actualBytes = Buffer.from(actual, 'ascii')
  return (
    expectedBytes.byteLength === actualBytes.byteLength &&
    timingSafeEqual(expectedBytes, actualBytes)
  )
}

async function readUpload(request: Request): Promise<Upload> {
  if (request.headers.get('Content-Type') !== ENCRYPTED_CONTENT_TYPE) {
    throw new Error('INVALID_CONTENT_TYPE')
  }
  const operationId = request.headers.get('X-MKB-Operation-Id') ?? ''
  const expectedSha256 = request.headers.get('X-MKB-Content-SHA256') ?? ''
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error('INVALID_OPERATION_ID')
  }
  if (!SHA256_PATTERN.test(expectedSha256)) {
    throw new Error('INVALID_CONTENT_SHA256')
  }
  const bytes = await readRawBodyWithLimit(request)
  if (bytes.byteLength < 1) throw new Error('EMPTY_ENCRYPTED_BACKUP')
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('INVALID_ENCRYPTED_ENVELOPE')
  }
  const actualSha256 = sha256Base64Url(content)
  if (!constantTimeMatches(expectedSha256, actualSha256)) {
    throw new Error('CONTENT_SHA256_MISMATCH')
  }
  validateEnvelopeShape(content)
  return {
    content,
    sha256: actualSha256,
    operationId,
    byteLength: bytes.byteLength,
  }
}

function uploadError(error: unknown, requestId: string): Response | null {
  if (error instanceof BodyReadError) {
    const status = error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400
    return apiError(
      status,
      error.code,
      error.code === 'PAYLOAD_TOO_LARGE'
        ? 'The encrypted backup exceeds 4,500,000 bytes.'
        : 'The encrypted backup request is invalid.',
      false,
      requestId,
      { stage: 'backup-upload' },
    )
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return apiError(
      400,
      error.message,
      'The encrypted backup request is invalid.',
      false,
      requestId,
      { stage: 'backup-upload' },
    )
  }
  return null
}

function gistError(
  error: unknown,
  requestId: string,
  stage: ApiStage,
): Response {
  if (!(error instanceof GistApiError)) {
    return apiError(
      500,
      'CLOUD_BACKUP_FAILED',
      'Cloud backup could not be completed.',
      true,
      requestId,
      { stage },
    )
  }
  const mapping = {
    'not-found': [404, 'GIST_NOT_FOUND', false],
    permission: [403, 'GITHUB_PERMISSION_REQUIRED', false],
    'rate-limit': [429, 'GITHUB_RATE_LIMIT', true],
    timeout: [504, 'GITHUB_TIMEOUT', true],
    unavailable: [503, 'GITHUB_UNAVAILABLE', true],
    'invalid-response': [502, 'GITHUB_RESPONSE_INVALID', true],
    'discovery-incomplete': [409, 'GIST_DISCOVERY_INCOMPLETE', false],
  } as const
  const [status, code, retryable] = mapping[error.kind]
  return apiError(
    status,
    code,
    error.kind === 'discovery-incomplete'
      ? 'Cloud backup discovery did not finish. No Gist was created.'
      : 'GitHub could not complete the cloud backup request.',
    retryable,
    requestId,
    {
      stage,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
  )
}

function writeResponse(verified: VerifiedBackupGist): CloudBackupWriteResponse {
  return {
    gistId: verified.metadata.gistId,
    revision: verified.metadata.revision,
    updatedAt: verified.metadata.updatedAt,
    encryptedSize: verified.metadata.encryptedSize,
    sha256: verified.sha256,
  }
}

function defaultDependencies(dependencies: BaseDependencies) {
  return {
    resolve:
      dependencies.resolveBackup ??
      ((token: string, userId: number, cached?: string) =>
        resolveCloudBackup(token, userId, cached)),
    getVerified:
      dependencies.getVerifiedGist ??
      ((gistId: string, token: string, userId: number) =>
        getVerifiedBackupGist(
          gistId,
          token,
          userId,
          ENCRYPTED_BACKUP_MAX_BYTES,
        )),
    create:
      dependencies.createGist ??
      ((content: string, token: string) => createBackupGist(content, token)),
    update:
      dependencies.updateGist ??
      ((gistId: string, content: string, token: string) =>
        updateBackupGist(gistId, content, token)),
  }
}

export async function handleCloudBackupDiscoveryRequest(
  request: Request,
  dependencies: BaseDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId)

  return withAuthenticatedSession(request, requestId, env, dependencies, async (payload) => {
    const cachedGistId = new URL(request.url).searchParams.get('gistId') ?? undefined
    if (cachedGistId) {
      try {
        validateGistId(cachedGistId)
      } catch {
        return apiError(
          400,
          'INVALID_GIST_ID',
          'The cached cloud backup ID is invalid.',
          false,
          requestId,
          { stage: 'backup-discovery' },
        )
      }
    }
    try {
      const { resolve } = defaultDependencies(dependencies)
      const result = await resolve(
        payload.accessToken,
        payload.user.id,
        cachedGistId,
      )
      return apiSuccess(result, requestId)
    } catch (error) {
      return gistError(error, requestId, 'backup-discovery')
    }
  })
}

export async function handleCloudBackupContentRequest(
  request: Request,
  dependencies: BaseDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId)
  const originFailure = sameOriginReadError(
    request,
    gate.origin.origin,
    requestId,
  )
  if (originFailure) return originFailure

  return withAuthenticatedSession(request, requestId, env, dependencies, async (payload) => {
    const gistId = new URL(request.url).searchParams.get('gistId') ?? ''
    try {
      validateGistId(gistId)
    } catch {
      return apiError(
        400,
        'INVALID_GIST_ID',
        'The cloud backup ID is invalid.',
        false,
        requestId,
        { stage: 'restore-download' },
      )
    }

    try {
      const { getVerified } = defaultDependencies(dependencies)
      const verified = await getVerified(
        gistId,
        payload.accessToken,
        payload.user.id,
      )
      validateEnvelopeShape(verified.content)
      const byteLength = Buffer.byteLength(verified.content, 'utf8')
      if (
        byteLength < 1 ||
        byteLength > ENCRYPTED_BACKUP_MAX_BYTES ||
        byteLength !== verified.metadata.encryptedSize ||
        !SHA256_PATTERN.test(verified.sha256)
      ) {
        throw new GistApiError('invalid-response')
      }
      return new Response(verified.content, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': ENCRYPTED_CONTENT_TYPE,
          'Content-Length': String(byteLength),
          'X-Request-Id': requestId,
          'X-MKB-Gist-Id': verified.metadata.gistId,
          'X-MKB-Revision': verified.metadata.revision,
          'X-MKB-Gist-Updated-At': verified.metadata.updatedAt,
          'X-MKB-Content-SHA256': verified.sha256,
        },
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_ENCRYPTED_ENVELOPE') {
        return apiError(
          502,
          'ENCRYPTED_BACKUP_INVALID',
          'The cloud backup is not a supported encrypted backup.',
          false,
          requestId,
          { stage: 'restore-download' },
        )
      }
      return gistError(error, requestId, 'restore-download')
    }
  })
}

async function recoverCreatedBackup(
  upload: Upload,
  payload: SessionPayloadV1,
  dependencies: ReturnType<typeof defaultDependencies>,
): Promise<VerifiedBackupGist | null> {
  try {
    const resolution = await dependencies.resolve(
      payload.accessToken,
      payload.user.id,
    )
    if (resolution.status !== 'selected') return null
    const verified = await dependencies.getVerified(
      resolution.backup.gistId,
      payload.accessToken,
      payload.user.id,
    )
    return verified.sha256 === upload.sha256 ? verified : null
  } catch {
    return null
  }
}

export async function handleCloudBackupCreateRequest(
  request: Request,
  dependencies: BaseDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId)
  const csrfFailure = csrfError(request, requestId)
  if (csrfFailure) return csrfFailure

  return withAuthenticatedSession(
    request,
    requestId,
    env,
    dependencies,
    async (payload) => {
      let upload: Upload
      try {
        upload = await readUpload(request)
      } catch (error) {
        return (
          uploadError(error, requestId) ??
          gistError(error, requestId, 'backup-upload')
        )
      }
      const helpers = defaultDependencies(dependencies)
      try {
        const resolution = await helpers.resolve(
          payload.accessToken,
          payload.user.id,
        )
        if (resolution.status !== 'none') {
          if (resolution.status === 'selected') {
            const existing = await helpers.getVerified(
              resolution.backup.gistId,
              payload.accessToken,
              payload.user.id,
            )
            if (existing.sha256 === upload.sha256) {
              return apiSuccess(writeResponse(existing), requestId)
            }
          }
          return apiError(
            409,
            'GIST_SELECTION_REQUIRED',
            'An existing cloud backup must be selected before uploading.',
            false,
            requestId,
            { stage: 'backup-upload' },
          )
        }

        let gistId: string
        try {
          gistId = await helpers.create(upload.content, payload.accessToken)
        } catch (error) {
          if (
            error instanceof GistApiError &&
            ['timeout', 'unavailable', 'invalid-response'].includes(error.kind)
          ) {
            const recovered = await recoverCreatedBackup(
              upload,
              payload,
              helpers,
            )
            if (recovered) return apiSuccess(writeResponse(recovered), requestId)
            return apiError(
              502,
              'UPLOAD_STATUS_UNKNOWN',
              'GitHub may have received the backup. Check again before retrying.',
              false,
              requestId,
              { stage: 'backup-upload' },
            )
          }
          throw error
        }
        const verified = await helpers.getVerified(
          gistId,
          payload.accessToken,
          payload.user.id,
        )
        if (
          verified.sha256 !== upload.sha256 ||
          verified.metadata.encryptedSize !== upload.byteLength
        ) {
          return apiError(
            502,
            'UPLOAD_STATUS_UNKNOWN',
            'The encrypted backup could not be verified after upload.',
            false,
            requestId,
            { stage: 'backup-upload' },
          )
        }
        return apiSuccess(writeResponse(verified), requestId, { status: 201 })
      } catch (error) {
        return gistError(error, requestId, 'backup-upload')
      }
    },
  )
}

export async function handleCloudBackupUpdateRequest(
  request: Request,
  dependencies: BaseDependencies = {},
): Promise<Response> {
  const requestId = (dependencies.createRequestId ?? createRequestId)()
  const env = dependencies.env ?? process.env
  const gate = requireProductionCloudEnvironment(request, requestId, env)
  if (gate.ok === false) return gate.response
  if (request.method !== 'PUT') return methodNotAllowed(['PUT'], requestId)
  const csrfFailure = csrfError(request, requestId)
  if (csrfFailure) return csrfFailure

  return withAuthenticatedSession(
    request,
    requestId,
    env,
    dependencies,
    async (payload) => {
      const gistId = new URL(request.url).searchParams.get('gistId') ?? ''
      const expectedRevision =
        request.headers.get('X-MKB-Expected-Revision') ?? ''
      try {
        validateGistId(gistId)
      } catch {
        return apiError(
          400,
          'INVALID_GIST_ID',
          'The cloud backup ID is invalid.',
          false,
          requestId,
          { stage: 'backup-upload' },
        )
      }
      if (!REVISION_PATTERN.test(expectedRevision)) {
        return apiError(
          400,
          'INVALID_EXPECTED_REVISION',
          'The expected cloud revision is invalid.',
          false,
          requestId,
          { stage: 'backup-upload' },
        )
      }

      let upload: Upload
      try {
        upload = await readUpload(request)
      } catch (error) {
        return (
          uploadError(error, requestId) ??
          gistError(error, requestId, 'backup-upload')
        )
      }
      const helpers = defaultDependencies(dependencies)
      try {
        const current = await helpers.getVerified(
          gistId,
          payload.accessToken,
          payload.user.id,
        )
        if (current.sha256 === upload.sha256) {
          return apiSuccess(writeResponse(current), requestId)
        }
        if (current.metadata.revision !== expectedRevision) {
          return apiError(
            409,
            'REMOTE_REVISION_CHANGED',
            'The cloud backup changed on another device.',
            false,
            requestId,
            { stage: 'backup-upload' },
          )
        }
        try {
          await helpers.update(gistId, upload.content, payload.accessToken)
        } catch (error) {
          if (
            error instanceof GistApiError &&
            ['timeout', 'unavailable', 'invalid-response'].includes(error.kind)
          ) {
            const recovered = await helpers.getVerified(
              gistId,
              payload.accessToken,
              payload.user.id,
            )
            if (recovered.sha256 === upload.sha256) {
              return apiSuccess(writeResponse(recovered), requestId)
            }
            return apiError(
              502,
              'UPLOAD_STATUS_UNKNOWN',
              'GitHub may have received the backup. Check again before retrying.',
              false,
              requestId,
              { stage: 'backup-upload' },
            )
          }
          throw error
        }
        const verified = await helpers.getVerified(
          gistId,
          payload.accessToken,
          payload.user.id,
        )
        if (
          verified.sha256 !== upload.sha256 ||
          verified.metadata.encryptedSize !== upload.byteLength
        ) {
          return apiError(
            502,
            'UPLOAD_STATUS_UNKNOWN',
            'The encrypted backup could not be verified after upload.',
            false,
            requestId,
            { stage: 'backup-upload' },
          )
        }
        return apiSuccess(writeResponse(verified), requestId)
      } catch (error) {
        return gistError(error, requestId, 'backup-upload')
      }
    },
  )
}
