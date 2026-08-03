import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudApiError,
  discoverCloudBackups,
  uploadCloudBackup,
  type CloudBackupMetadata,
} from '../lib/cloudApi'
import { createBackupDocument } from '../lib/backup'
import {
  getStoredCloudBackupMetadata,
  setStoredCloudBackupMetadata,
  type StoredCloudBackupMetadata,
} from '../lib/cloudMetadata'
import {
  encryptBackupDocument,
  serializeEncryptedBackupEnvelope,
  validateNewBackupPassphrase,
} from '../lib/cloudCrypto'
import { getAllNotes } from '../lib/db'
import type { GitHubSessionState } from './useGitHubSession'

export type CloudBackupDiscoveryState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'selected'; backup: CloudBackupMetadata }
  | { status: 'selection-required'; candidates: CloudBackupMetadata[] }
  | { status: 'unavailable' }

export type CloudBackupNotice = {
  tone: 'success' | 'warning'
  message: string
  code?: string
}

async function withExclusiveBackupLock<T>(task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return task()
  return navigator.locks.request(
    'mkb-cloud-backup',
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) {
        throw new CloudApiError(
          'BACKUP_ALREADY_RUNNING',
          'A cloud backup is already running in another tab.',
        )
      }
      return task()
    },
  )
}

export function useCloudBackup(options: {
  enabled: boolean
  session: GitHubSessionState
  csrfToken: string | null
  isOnline: boolean
}) {
  const user =
    options.session.status === 'signed-in' ? options.session.user : null
  const [discovery, setDiscovery] = useState<CloudBackupDiscoveryState>({
    status: 'idle',
  })
  const [storedMetadata, setStoredMetadata] =
    useState<StoredCloudBackupMetadata | null>(null)
  const [notice, setNotice] = useState<CloudBackupNotice | null>(null)
  const [uploading, setUploading] = useState(false)
  const operationRef = useRef(0)

  const discover = useCallback(
    async (cachedGistId?: string) => {
      if (!options.enabled || !user || !options.isOnline) {
        setDiscovery({ status: 'idle' })
        return null
      }
      const operation = ++operationRef.current
      setDiscovery({ status: 'checking' })
      try {
        const result = await discoverCloudBackups(cachedGistId)
        if (operation !== operationRef.current) return null
        setDiscovery(result)
        return result
      } catch (error) {
        if (operation !== operationRef.current) return null
        setDiscovery({ status: 'unavailable' })
        setNotice({
          tone: 'warning',
          message:
            error instanceof CloudApiError
              ? error.message
              : 'Cloud backup discovery could not be completed.',
          ...(error instanceof CloudApiError ? { code: error.code } : {}),
        })
        return null
      }
    },
    [options.enabled, options.isOnline, user],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      operationRef.current += 1
      setNotice(null)
      if (!user || !options.enabled) {
        setStoredMetadata(null)
        setDiscovery({ status: 'idle' })
        return
      }
      const cached = getStoredCloudBackupMetadata(user.id)
      setStoredMetadata(cached)
      if (options.isOnline) void discover(cached?.gistId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [discover, options.enabled, options.isOnline, user])

  const selectCandidate = useCallback(
    async (gistId: string) => {
      const result = await discover(gistId)
      if (result?.status !== 'selected') {
        throw new CloudApiError(
          'GIST_SELECTION_FAILED',
          'The selected cloud backup could not be verified.',
        )
      }
      return result.backup
    },
    [discover],
  )

  const upload = useCallback(
    async (passphrase: string, confirmation: string) => {
      if (!options.isOnline) {
        throw new CloudApiError('OFFLINE', 'You are offline.')
      }
      if (!user || !options.csrfToken) {
        throw new CloudApiError('AUTH_REQUIRED', 'GitHub sign-in is required.')
      }
      if (uploading) {
        throw new CloudApiError(
          'BACKUP_ALREADY_RUNNING',
          'A cloud backup is already running.',
        )
      }
      if (
        discovery.status !== 'none' &&
        discovery.status !== 'selected'
      ) {
        throw new CloudApiError(
          'GIST_SELECTION_REQUIRED',
          'Select a cloud backup before uploading.',
        )
      }

      const normalizedPassphrase = validateNewBackupPassphrase(
        passphrase,
        confirmation,
      )
      setUploading(true)
      setNotice(null)
      try {
        return await withExclusiveBackupLock(async () => {
          const notes = (await getAllNotes()).sort((left, right) =>
            left.id.localeCompare(right.id),
          )
          const document = createBackupDocument(notes, new Date().toISOString())
          const envelope = await encryptBackupDocument(
            document,
            normalizedPassphrase,
          )
          const content = serializeEncryptedBackupEnvelope(envelope)
          const current =
            discovery.status === 'selected'
              ? {
                  gistId: discovery.backup.gistId,
                  revision: discovery.backup.revision,
                }
              : undefined
          const result = await uploadCloudBackup({
            content,
            csrfToken: options.csrfToken!,
            current,
          })
          const metadata = setStoredCloudBackupMetadata(
            user.id,
            result,
            discovery.status === 'selected'
              ? discovery.backup.htmlUrl
              : undefined,
          )
          setStoredMetadata(metadata)
          setDiscovery({ status: 'selected', backup: metadata })
          setNotice({
            tone: 'success',
            message: `Encrypted cloud backup completed (${notes.length} notes).`,
          })
          return metadata
        })
      } catch (error) {
        setNotice({
          tone: 'warning',
          message:
            error instanceof Error
              ? error.message
              : 'Cloud backup could not be completed.',
          ...(error instanceof CloudApiError ? { code: error.code } : {}),
        })
        throw error
      } finally {
        setUploading(false)
      }
    },
    [
      discovery,
      options.csrfToken,
      options.isOnline,
      uploading,
      user,
    ],
  )

  return {
    discovery,
    storedMetadata,
    notice,
    uploading,
    discover,
    selectCandidate,
    upload,
    clearNotice: () => setNotice(null),
  }
}
