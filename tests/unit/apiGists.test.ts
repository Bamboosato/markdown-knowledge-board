import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  BACKUP_GIST_DESCRIPTION,
  BACKUP_GIST_FILENAME,
  createBackupGist,
  getVerifiedBackupGist,
  GistApiError,
  resolveCloudBackup,
  updateBackupGist,
} from '../../api/_lib/gists.js'

const USER_ID = 123
const TOKEN = 'ghu_access'
const REVISION = 'a'.repeat(40)
const ETAG_REVISION = 'b'.repeat(64)

function gist(options: {
  id?: string
  content?: string
  truncated?: boolean
  rawUrl?: string
  description?: string
  ownerId?: number
  revision?: string
} = {}) {
  const id = options.id ?? 'a1'
  const content = options.content ?? '{"encrypted":true}'
  return {
    id,
    description: options.description ?? BACKUP_GIST_DESCRIPTION,
    owner: { id: options.ownerId ?? USER_ID },
    updated_at: '2026-08-03T05:00:00.000Z',
    html_url: `https://gist.github.com/octocat/${id}`,
    history: [{ version: options.revision ?? REVISION }],
    files: {
      [BACKUP_GIST_FILENAME]: {
        size: Buffer.byteLength(content, 'utf8'),
        truncated: options.truncated ?? false,
        ...(options.truncated ? {} : { content }),
        ...(options.rawUrl ? { raw_url: options.rawUrl } : {}),
      },
    },
  }
}

describe('GitHub Gist backup discovery', () => {
  it('uses a valid cached Gist without listing every Gist', async () => {
    const fetchImpl = vi.fn(async () => Response.json(gist()))

    await expect(
      resolveCloudBackup(TOKEN, USER_ID, 'a1', { fetchImpl }),
    ).resolves.toMatchObject({
      status: 'selected',
      backup: { gistId: 'a1', revision: REVISION },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.github.com/gists/a1',
    )
  })

  it('uses the full-Gist ETag when API version 2026-03-10 omits history', async () => {
    const currentApiGist = { ...gist(), history: undefined }
    const fetchImpl = vi.fn(async () =>
      Response.json(currentApiGist, {
        headers: { ETag: `W/"${ETAG_REVISION}"` },
      }),
    )

    await expect(
      resolveCloudBackup(TOKEN, USER_ID, 'a1', { fetchImpl }),
    ).resolves.toMatchObject({
      status: 'selected',
      backup: { gistId: 'a1', revision: ETAG_REVISION },
    })
  })

  it('fails closed when a full Gist has neither an ETag nor history revision', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ...gist(), history: undefined }),
    )

    await expect(
      resolveCloudBackup(TOKEN, USER_ID, 'a1', { fetchImpl }),
    ).rejects.toMatchObject<GistApiError>({ kind: 'invalid-response' })
  })

  it('returns all exact-match candidates and never selects among multiples', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('?per_page=100&page=1')) {
        return Response.json([gist({ id: 'a1' }), gist({ id: 'b2' })])
      }
      if (url.endsWith('/a1')) return Response.json(gist({ id: 'a1' }))
      if (url.endsWith('/b2')) {
        return Response.json(gist({ id: 'b2', revision: 'b'.repeat(40) }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    await expect(
      resolveCloudBackup(TOKEN, USER_ID, undefined, { fetchImpl }),
    ).resolves.toMatchObject({
      status: 'selection-required',
      candidates: [{ gistId: 'a1' }, { gistId: 'b2' }],
    })
  })

  it('fails closed when pagination continues beyond the 1,000-Gist bound', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page'))
      return Response.json([], {
        headers: {
          Link: `<https://api.github.com/gists?per_page=100&page=${page + 1}>; rel="next"`,
        },
      })
    })

    await expect(
      resolveCloudBackup(TOKEN, USER_ID, undefined, { fetchImpl }),
    ).rejects.toMatchObject<GistApiError>({ kind: 'discovery-incomplete' })
    expect(fetchImpl).toHaveBeenCalledTimes(10)
  })

  it('ignores same-named Gists owned by another user', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([gist({ ownerId: USER_ID + 1 })]),
    )
    await expect(
      resolveCloudBackup(TOKEN, USER_ID, undefined, { fetchImpl }),
    ).resolves.toEqual({ status: 'none' })
  })

  it('ignores ordinary Gists whose description is null', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([{ ...gist(), description: null }]),
    )
    await expect(
      resolveCloudBackup(TOKEN, USER_ID, undefined, { fetchImpl }),
    ).resolves.toEqual({ status: 'none' })
  })
})

describe('GitHub Gist encrypted content handling', () => {
  it('downloads a truncated file only from the pinned raw Gist host', async () => {
    const content = '暗号化バックアップ'
    const rawUrl = 'https://gist.githubusercontent.com/octocat/a1/raw/revision/file'
    let rawRequestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://api.github.com/gists/a1') {
        return Response.json(gist({ content, truncated: true, rawUrl }))
      }
      rawRequestInit = init
      return new Response(content)
    })

    await expect(
      getVerifiedBackupGist('a1', TOKEN, USER_ID, 4_500_000, { fetchImpl }),
    ).resolves.toMatchObject({
      metadata: { encryptedSize: Buffer.byteLength(content, 'utf8') },
      content,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const rawHeaders = new Headers(rawRequestInit?.headers)
    expect(rawHeaders.has('Authorization')).toBe(false)
    expect(rawHeaders.get('Accept')).toBe('application/octet-stream')
    expect(rawRequestInit?.redirect).toBe('manual')
  })

  it('follows at most two validated raw-host redirects without forwarding authorization', async () => {
    const content = 'redirected ciphertext'
    const first = 'https://gist.githubusercontent.com/octocat/a1/raw/one/file'
    const second = 'https://gist.githubusercontent.com/octocat/a1/raw/two/file'
    const third = 'https://gist.githubusercontent.com/octocat/a1/raw/three/file'
    const rawRequests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://api.github.com/gists/a1') {
        return Response.json(gist({ content, truncated: true, rawUrl: first }))
      }
      rawRequests.push({ url, init })
      if (url === first) return new Response(null, { status: 302, headers: { Location: second } })
      if (url === second) return new Response(null, { status: 307, headers: { Location: third } })
      return new Response(content)
    })

    await expect(
      getVerifiedBackupGist('a1', TOKEN, USER_ID, 4_500_000, { fetchImpl }),
    ).resolves.toMatchObject({ content })
    expect(rawRequests.map(({ url }) => url)).toEqual([first, second, third])
    for (const request of rawRequests) {
      expect(new Headers(request.init?.headers).has('Authorization')).toBe(false)
      expect(request.init?.redirect).toBe('manual')
    }
  })

  it('rejects an untrusted redirect and a third redirect before fetching its target', async () => {
    const content = 'ciphertext'
    const first = 'https://gist.githubusercontent.com/octocat/a1/raw/one/file'
    const untrustedFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'https://api.github.com/gists/a1') {
        return Response.json(gist({ content, truncated: true, rawUrl: first }))
      }
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://example.test/stolen' },
      })
    })
    await expect(
      getVerifiedBackupGist('a1', TOKEN, USER_ID, 4_500_000, {
        fetchImpl: untrustedFetch,
      }),
    ).rejects.toMatchObject<GistApiError>({ kind: 'invalid-response' })
    expect(untrustedFetch).toHaveBeenCalledTimes(2)

    const urls = [first, '/octocat/a1/raw/two/file', '/octocat/a1/raw/three/file']
    const excessiveFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'https://api.github.com/gists/a1') {
        return Response.json(gist({ content, truncated: true, rawUrl: first }))
      }
      const index = excessiveFetch.mock.calls.length - 2
      return new Response(null, {
        status: 302,
        headers: { Location: urls[index + 1] ?? '/octocat/a1/raw/four/file' },
      })
    })
    await expect(
      getVerifiedBackupGist('a1', TOKEN, USER_ID, 4_500_000, {
        fetchImpl: excessiveFetch,
      }),
    ).rejects.toMatchObject<GistApiError>({ kind: 'invalid-response' })
    expect(excessiveFetch).toHaveBeenCalledTimes(4)
  })

  it('rejects malformed and non-GitHub raw URLs before a second request', async () => {
    for (const rawUrl of [
      'not a URL',
      'https://example.test/stolen',
      'https://user:secret@gist.githubusercontent.com/octocat/a1/raw/file',
      'https://gist.githubusercontent.com:444/octocat/a1/raw/file',
    ]) {
      const fetchImpl = vi.fn(async () =>
        Response.json(gist({ truncated: true, rawUrl })),
      )
      await expect(
        getVerifiedBackupGist('a1', TOKEN, USER_ID, 4_500_000, { fetchImpl }),
      ).rejects.toMatchObject<GistApiError>({ kind: 'invalid-response' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects a malformed pagination URL as an API response error', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([], { headers: { Link: '<not a URL>; rel="next"' } }),
    )
    await expect(
      resolveCloudBackup(TOKEN, USER_ID, undefined, { fetchImpl }),
    ).rejects.toMatchObject<GistApiError>({ kind: 'invalid-response' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed Gist HTML URLs as an API response error', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ...gist(), html_url: 'not a URL' }),
    )
    await expect(
      resolveCloudBackup(TOKEN, USER_ID, 'a1', { fetchImpl }),
    ).rejects.toMatchObject<GistApiError>({ kind: 'invalid-response' })
  })

  it('creates a secret Gist and updates only the backup file', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return init?.method === 'POST' ? Response.json(gist()) : new Response(null)
    })

    await expect(
      createBackupGist('ciphertext', TOKEN, { fetchImpl }),
    ).resolves.toBe('a1')
    await updateBackupGist('a1', 'new-ciphertext', TOKEN, { fetchImpl })

    const created = JSON.parse(String(requests[0]?.init?.body))
    expect(created).toEqual({
      description: BACKUP_GIST_DESCRIPTION,
      public: false,
      files: { [BACKUP_GIST_FILENAME]: { content: 'ciphertext' } },
    })
    const updated = JSON.parse(String(requests[1]?.init?.body))
    expect(updated).toEqual({
      files: { [BACKUP_GIST_FILENAME]: { content: 'new-ciphertext' } },
    })
  })
})
