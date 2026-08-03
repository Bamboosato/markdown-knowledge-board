import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  handleCloudBackupCreateRequest,
  handleCloudBackupDiscoveryRequest,
  handleCloudBackupUpdateRequest,
} from '../../api/_lib/cloudBackups.js'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../../api/_lib/csrf.js'
import {
  GistApiError,
  sha256Base64Url,
  type VerifiedBackupGist,
} from '../../api/_lib/gists.js'
import { ORIGIN_CONFIG } from '../../api/_lib/origins.js'
import {
  parseSessionKeyRing,
  sealSession,
  SESSION_COOKIE_NAME,
  type SessionPayloadV1,
} from '../../api/_lib/session.js'

const NOW = Date.UTC(2026, 7, 3, 5, 0, 0)
const REQUEST_ID = '60000000-0000-4000-8000-000000000006'
const OPERATION_ID = '60000000-0000-4000-8000-000000000007'
const CSRF = Buffer.alloc(32, 7).toString('base64url')
const keyConfig = JSON.stringify({
  active: { id: 'active', key: Buffer.alloc(32, 6).toString('base64url') },
})

function productionEnv() {
  return { VERCEL_ENV: 'production', SESSION_KEYS: keyConfig }
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

const baseDependencies = {
  env: productionEnv(),
  now: () => NOW,
  createRequestId: () => REQUEST_ID,
}

function envelopeOfSize(targetSize?: number): string {
  const prefix =
    '{"app":"markdown-knowledge-board","envelopeVersion":1,"crypto":{},"ciphertext":"'
  const suffix = '"}'
  const size = targetSize ?? 256
  if (size < Buffer.byteLength(prefix + 'x' + suffix, 'utf8')) {
    throw new Error('Target encrypted envelope size is too small.')
  }
  const content = prefix + 'x'.repeat(size - Buffer.byteLength(prefix + suffix, 'utf8')) + suffix
  expect(Buffer.byteLength(content, 'utf8')).toBe(size)
  return content
}

function verified(content: string, options: { revision?: string; gistId?: string } = {}): VerifiedBackupGist {
  return {
    metadata: {
      gistId: options.gistId ?? 'a1',
      revision: options.revision ?? 'a'.repeat(40),
      updatedAt: '2026-08-03T05:00:00.000Z',
      htmlUrl: 'https://gist.github.com/octocat/a1',
      encryptedSize: Buffer.byteLength(content, 'utf8'),
    },
    content,
    sha256: sha256Base64Url(content),
  }
}

async function authCookie(payload: SessionPayloadV1 = sessionPayload()) {
  const sealed = await sealSession(payload, parseSessionKeyRing(keyConfig))
  return `${SESSION_COOKIE_NAME}=${sealed}`
}

async function discoveryRequest(path = '/api/cloud-backups') {
  return new Request(`${ORIGIN_CONFIG.primary.origin}${path}`, {
    headers: {
      Origin: ORIGIN_CONFIG.primary.origin,
      Cookie: await authCookie(),
    },
  })
}

async function uploadRequest(
  method: 'POST' | 'PUT',
  content: string,
  options: { gistId?: string; revision?: string; sha256?: string; csrf?: string } = {},
) {
  const path = options.gistId
    ? `/api/cloud-backups/update?gistId=${options.gistId}`
    : '/api/cloud-backups'
  return new Request(`${ORIGIN_CONFIG.primary.origin}${path}`, {
    method,
    headers: {
      Origin: ORIGIN_CONFIG.primary.origin,
      Cookie: `${await authCookie()}; ${CSRF_COOKIE_NAME}=${CSRF}`,
      [CSRF_HEADER_NAME]: options.csrf ?? CSRF,
      'Content-Type': 'application/vnd.mkb.encrypted-backup+json',
      'Content-Length': String(Buffer.byteLength(content, 'utf8')),
      'X-MKB-Operation-Id': OPERATION_ID,
      'X-MKB-Content-SHA256': options.sha256 ?? sha256Base64Url(content),
      ...(options.revision
        ? { 'X-MKB-Expected-Revision': options.revision }
        : {}),
    },
    body: content,
  })
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } }
  return body.error?.code
}

describe('GET /api/cloud-backups', () => {
  it('discovers through the authenticated session and forwards a cached Gist ID', async () => {
    const resolveBackup = vi.fn(async () => ({ status: 'none' as const }))
    const response = await handleCloudBackupDiscoveryRequest(
      await discoveryRequest('/api/cloud-backups?gistId=a1'),
      { ...baseDependencies, resolveBackup },
    )
    expect(response.status).toBe(200)
    expect(resolveBackup).toHaveBeenCalledWith('ghu_access', 123, 'a1')
  })

  it('keeps Preview/local cloud routes unavailable before GitHub access', async () => {
    const resolveBackup = vi.fn()
    const response = await handleCloudBackupDiscoveryRequest(
      new Request('https://preview.example.test/api/cloud-backups'),
      {
        ...baseDependencies,
        env: { ...productionEnv(), VERCEL_ENV: 'preview' },
        resolveBackup,
      },
    )
    expect(response.status).toBe(404)
    expect(await errorCode(response)).toBe('CLOUD_NOT_AVAILABLE')
    expect(resolveBackup).not.toHaveBeenCalled()
  })

  it('requires a live signed-in session without blocking local application state', async () => {
    const response = await handleCloudBackupDiscoveryRequest(
      new Request(`${ORIGIN_CONFIG.primary.origin}/api/cloud-backups`, {
        headers: { Origin: ORIGIN_CONFIG.primary.origin },
      }),
      baseDependencies,
    )
    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('AUTH_REQUIRED')
  })

  it.each([
    ['permission', 403, 'GITHUB_PERMISSION_REQUIRED', undefined],
    ['rate-limit', 429, 'GITHUB_RATE_LIMIT', 27],
  ] as const)(
    'maps GitHub %s failures without treating discovery as successful',
    async (kind, status, code, retryAfterSeconds) => {
      const response = await handleCloudBackupDiscoveryRequest(
        await discoveryRequest(),
        {
          ...baseDependencies,
          resolveBackup: vi.fn(async () => {
            throw new GistApiError(kind, { retryAfterSeconds })
          }),
        },
      )
      expect(response.status).toBe(status)
      const body = (await response.json()) as {
        error: { code: string; retryAfterSeconds?: number }
      }
      expect(body.error).toMatchObject({
        code,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      })
    },
  )
})

describe('POST /api/cloud-backups', () => {
  it('creates and verifies a new encrypted backup only after discovery returns none', async () => {
    const content = envelopeOfSize()
    const resolveBackup = vi.fn(async () => ({ status: 'none' as const }))
    const createGist = vi.fn(async () => 'a1')
    const getVerifiedGist = vi.fn(async () => verified(content))
    const response = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', content),
      { ...baseDependencies, resolveBackup, createGist, getVerifiedGist },
    )
    expect(response.status).toBe(201)
    expect(createGist).toHaveBeenCalledWith(content, 'ghu_access')
    expect(getVerifiedGist).toHaveBeenCalledWith('a1', 'ghu_access', 123)
  })

  it('is idempotent when an existing selected backup already has the same hash', async () => {
    const content = envelopeOfSize()
    const existing = verified(content)
    const createGist = vi.fn()
    const response = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', content),
      {
        ...baseDependencies,
        resolveBackup: vi.fn(async () => ({ status: 'selected' as const, backup: existing.metadata })),
        getVerifiedGist: vi.fn(async () => existing),
        createGist,
      },
    )
    expect(response.status).toBe(200)
    expect(createGist).not.toHaveBeenCalled()
  })

  it('does not overwrite or create when an existing backup differs', async () => {
    const content = envelopeOfSize()
    const existing = verified(envelopeOfSize(257))
    const createGist = vi.fn()
    const response = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', content),
      {
        ...baseDependencies,
        resolveBackup: vi.fn(async () => ({ status: 'selected' as const, backup: existing.metadata })),
        getVerifiedGist: vi.fn(async () => existing),
        createGist,
      },
    )
    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('GIST_SELECTION_REQUIRED')
    expect(createGist).not.toHaveBeenCalled()
  })

  it('accepts 4,500,000 bytes and rejects 4,500,001 before contacting GitHub', async () => {
    const atLimit = envelopeOfSize(4_500_000)
    const createGist = vi.fn(async () => 'a1')
    const response = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', atLimit),
      {
        ...baseDependencies,
        resolveBackup: vi.fn(async () => ({ status: 'none' as const })),
        createGist,
        getVerifiedGist: vi.fn(async () => verified(atLimit)),
      },
    )
    expect(response.status).toBe(201)

    const overLimit = envelopeOfSize(4_500_001)
    const resolveBackup = vi.fn()
    const rejected = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', overLimit),
      { ...baseDependencies, resolveBackup },
    )
    expect(rejected.status).toBe(413)
    expect(await errorCode(rejected)).toBe('PAYLOAD_TOO_LARGE')
    expect(resolveBackup).not.toHaveBeenCalled()
  })

  it('rejects invalid CSRF and content hashes before discovery', async () => {
    const content = envelopeOfSize()
    const resolveBackup = vi.fn()
    const csrfFailure = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', content, {
        csrf: Buffer.alloc(32, 8).toString('base64url'),
      }),
      { ...baseDependencies, resolveBackup },
    )
    expect(csrfFailure.status).toBe(403)

    const hashFailure = await handleCloudBackupCreateRequest(
      await uploadRequest('POST', content, { sha256: 'a'.repeat(43) }),
      { ...baseDependencies, resolveBackup },
    )
    expect(hashFailure.status).toBe(400)
    expect(await errorCode(hashFailure)).toBe('CONTENT_SHA256_MISMATCH')
    expect(resolveBackup).not.toHaveBeenCalled()
  })
})

describe('PUT /api/cloud-backups/update', () => {
  it('updates only after the expected remote revision still matches', async () => {
    const content = envelopeOfSize()
    const previous = verified(envelopeOfSize(257), { revision: 'a'.repeat(40) })
    const next = verified(content, { revision: 'b'.repeat(40) })
    const getVerifiedGist = vi
      .fn()
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(next)
    const updateGist = vi.fn(async () => undefined)
    const response = await handleCloudBackupUpdateRequest(
      await uploadRequest('PUT', content, {
        gistId: 'a1',
        revision: previous.metadata.revision,
      }),
      { ...baseDependencies, getVerifiedGist, updateGist },
    )
    expect(response.status).toBe(200)
    expect(updateGist).toHaveBeenCalledWith('a1', content, 'ghu_access')
  })

  it('reports a remote revision conflict without updating', async () => {
    const content = envelopeOfSize()
    const updateGist = vi.fn()
    const response = await handleCloudBackupUpdateRequest(
      await uploadRequest('PUT', content, {
        gistId: 'a1',
        revision: 'a'.repeat(40),
      }),
      {
        ...baseDependencies,
        getVerifiedGist: vi.fn(async () =>
          verified(envelopeOfSize(257), { revision: 'b'.repeat(40) }),
        ),
        updateGist,
      },
    )
    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('REMOTE_REVISION_CHANGED')
    expect(updateGist).not.toHaveBeenCalled()
  })

  it('treats an already-matching hash as success even after a revision change', async () => {
    const content = envelopeOfSize()
    const updateGist = vi.fn()
    const response = await handleCloudBackupUpdateRequest(
      await uploadRequest('PUT', content, {
        gistId: 'a1',
        revision: 'a'.repeat(40),
      }),
      {
        ...baseDependencies,
        getVerifiedGist: vi.fn(async () =>
          verified(content, { revision: 'b'.repeat(40) }),
        ),
        updateGist,
      },
    )
    expect(response.status).toBe(200)
    expect(updateGist).not.toHaveBeenCalled()
  })
})
