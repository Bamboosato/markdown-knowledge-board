import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getStoredCloudBackupMetadata,
  removeStoredCloudBackupMetadata,
  setStoredCloudBackupMetadata,
} from '../../src/lib/cloudMetadata'

const STORAGE_KEY = 'mkb.cloud-backup.v1'

function result(gistId: string) {
  return {
    gistId,
    revision: 'a'.repeat(40),
    updatedAt: '2026-08-03T05:00:00.000Z',
    encryptedSize: 1024,
    sha256: 's'.repeat(43),
  }
}

describe('per-user cloud backup metadata cache', () => {
  let values: Map<string, string>

  beforeEach(() => {
    values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('stores only backup metadata under the numeric GitHub user', () => {
    setStoredCloudBackupMetadata(123, result('a1'))
    expect(getStoredCloudBackupMetadata(123)).toMatchObject({
      gistId: 'a1',
      htmlUrl: 'https://gist.github.com/a1',
      sha256: 's'.repeat(43),
    })
    const raw = values.get(STORAGE_KEY) ?? ''
    expect(raw).not.toContain('passphrase')
    expect(raw).not.toContain('ciphertext')
    expect(raw).not.toContain('accessToken')
  })

  it('does not share cached backup IDs between GitHub accounts', () => {
    setStoredCloudBackupMetadata(123, result('a1'))
    setStoredCloudBackupMetadata(456, result('b2'))
    expect(getStoredCloudBackupMetadata(123)?.gistId).toBe('a1')
    expect(getStoredCloudBackupMetadata(456)?.gistId).toBe('b2')
  })

  it('removes only the disconnected account cache', () => {
    setStoredCloudBackupMetadata(123, result('a1'))
    setStoredCloudBackupMetadata(456, result('b2'))
    removeStoredCloudBackupMetadata(123)
    expect(getStoredCloudBackupMetadata(123)).toBeNull()
    expect(getStoredCloudBackupMetadata(456)?.gistId).toBe('b2')
  })

  it('fails closed on malformed or out-of-range persisted values', () => {
    values.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        users: {
          123: { ...result('a1'), encryptedSize: 4_500_001, htmlUrl: 'https://gist.github.com/a1' },
        },
      }),
    )
    expect(getStoredCloudBackupMetadata(123)).toBeNull()

    values.set(STORAGE_KEY, '{broken')
    expect(getStoredCloudBackupMetadata(123)).toBeNull()
  })
})
