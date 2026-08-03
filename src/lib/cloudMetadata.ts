import type { CloudBackupMetadata, CloudBackupWriteData } from './cloudApi'

const STORAGE_KEY = 'mkb.cloud-backup.v1'

export type StoredCloudBackupMetadata = CloudBackupMetadata & {
  sha256: string
}

type MetadataStore = {
  version: 1
  users: Record<string, StoredCloudBackupMetadata>
}

function emptyStore(): MetadataStore {
  return { version: 1, users: {} }
}

function isStoredMetadata(value: unknown): value is StoredCloudBackupMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.gistId === 'string' &&
    /^[A-Fa-f0-9]{1,64}$/.test(item.gistId) &&
    typeof item.revision === 'string' &&
    /^[A-Fa-f0-9]{40,64}$/.test(item.revision) &&
    typeof item.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(item.updatedAt)) &&
    typeof item.htmlUrl === 'string' &&
    /^https:\/\/gist\.github\.com\//.test(item.htmlUrl) &&
    Number.isSafeInteger(item.encryptedSize) &&
    (item.encryptedSize as number) >= 1 &&
    (item.encryptedSize as number) <= 4_500_000 &&
    typeof item.sha256 === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(item.sha256)
  )
}

function readStore(): MetadataStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return emptyStore()
    }
    const record = parsed as Record<string, unknown>
    if (record.version !== 1 || !record.users || typeof record.users !== 'object') {
      return emptyStore()
    }
    const users: Record<string, StoredCloudBackupMetadata> = {}
    for (const [userId, metadata] of Object.entries(record.users)) {
      if (/^[1-9]\d*$/.test(userId) && isStoredMetadata(metadata)) {
        users[userId] = metadata
      }
    }
    return { version: 1, users }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: MetadataStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Cloud metadata is only a cache; local note operations must remain usable.
  }
}

export function getStoredCloudBackupMetadata(
  userId: number,
): StoredCloudBackupMetadata | null {
  return readStore().users[String(userId)] ?? null
}

export function setStoredCloudBackupMetadata(
  userId: number,
  result: CloudBackupWriteData,
  htmlUrl?: string,
): StoredCloudBackupMetadata {
  const metadata: StoredCloudBackupMetadata = {
    ...result,
    htmlUrl: htmlUrl ?? `https://gist.github.com/${result.gistId}`,
  }
  const store = readStore()
  store.users[String(userId)] = metadata
  writeStore(store)
  return metadata
}

export function removeStoredCloudBackupMetadata(userId: number): void {
  const store = readStore()
  delete store.users[String(userId)]
  writeStore(store)
}
