import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackupDocument } from '../lib/backup'
import {
  CloudApiError,
  downloadCloudBackup,
  type CloudBackupContent,
} from '../lib/cloudApi'
import {
  decryptBackupEnvelope,
  parseEncryptedBackupEnvelope,
} from '../lib/cloudCrypto'
import {
  buildRestorePlan,
  createNotesFromBackupDocument,
  getNotesToApply,
  type RestoreAction,
  type RestorePlanItem,
} from '../lib/cloudRestore'
import { applyNotesTransaction, getAllNotes } from '../lib/db'
import type { GitHubSessionState } from './useGitHubSession'

export type CloudRestoreCounts = Record<RestoreAction, number> & {
  failed: number
}

export type CloudRestorePreview = {
  createdAt: string
  noteCount: number
  plan: RestorePlanItem[]
  counts: CloudRestoreCounts
  gistId: string
  revision: string
  gistUpdatedAt: string
}

export class CloudRestoreApplyError extends CloudApiError {
  readonly counts: CloudRestoreCounts

  constructor(counts: CloudRestoreCounts) {
    super(
      'RESTORE_APPLY_FAILED',
      'Cloud restore could not be applied. All local note changes were rolled back.',
    )
    this.name = 'CloudRestoreApplyError'
    this.counts = counts
  }
}

function countPlan(
  plan: RestorePlanItem[],
  failed = 0,
): CloudRestoreCounts {
  const counts: CloudRestoreCounts = {
    added: 0,
    updated: 0,
    skipped: 0,
    conflicted: 0,
    failed,
  }
  for (const item of plan) counts[item.action] += 1
  return counts
}

function samePlan(left: RestorePlanItem[], right: RestorePlanItem[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        item.id === other.id &&
        item.action === other.action &&
        item.reason === other.reason &&
        item.localUpdatedAt === other.localUpdatedAt &&
        item.cloudUpdatedAt === other.cloudUpdatedAt
      )
    })
  )
}

async function withExclusiveRestoreLock<T>(task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return task()
  return navigator.locks.request(
    'mkb-cloud-restore',
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) {
        throw new CloudApiError(
          'RESTORE_ALREADY_RUNNING',
          'A cloud restore is already running in another tab.',
        )
      }
      return task()
    },
  )
}

export function useCloudRestore(options: {
  enabled: boolean
  session: GitHubSessionState
  isOnline: boolean
}) {
  const [downloading, setDownloading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<CloudRestorePreview | null>(null)
  const [result, setResult] = useState<CloudRestoreCounts | null>(null)
  const contentRef = useRef<CloudBackupContent | null>(null)
  const documentRef = useRef<BackupDocument | null>(null)
  const operationRef = useRef(0)
  const signedIn = options.session.status === 'signed-in'

  const clear = useCallback(() => {
    operationRef.current += 1
    contentRef.current = null
    documentRef.current = null
    setDownloading(false)
    setPreparing(false)
    setApplying(false)
    setPreview(null)
    setResult(null)
  }, [])

  useEffect(() => {
    if (options.enabled && signedIn) return
    const timer = window.setTimeout(clear, 0)
    return () => window.clearTimeout(timer)
  }, [clear, options.enabled, signedIn])

  const download = useCallback(
    async (gistId: string) => {
      if (!options.enabled || !signedIn) {
        throw new CloudApiError('AUTH_REQUIRED', 'GitHub sign-in is required.')
      }
      if (!options.isOnline) {
        throw new CloudApiError('OFFLINE', 'You are offline.')
      }
      const operation = ++operationRef.current
      contentRef.current = null
      documentRef.current = null
      setPreview(null)
      setResult(null)
      setDownloading(true)
      try {
        const content = await downloadCloudBackup(gistId)
        parseEncryptedBackupEnvelope(content.content)
        if (operation !== operationRef.current) return null
        contentRef.current = content
        return content
      } finally {
        if (operation === operationRef.current) setDownloading(false)
      }
    },
    [options.enabled, options.isOnline, signedIn],
  )

  const prepare = useCallback(async (passphrase: string) => {
    const content = contentRef.current
    if (!content) {
      throw new CloudApiError(
        'RESTORE_NOT_DOWNLOADED',
        'Download the cloud backup before decrypting it.',
      )
    }
    setPreparing(true)
    setResult(null)
    try {
      const envelope = parseEncryptedBackupEnvelope(content.content)
      const document = await decryptBackupEnvelope(envelope, passphrase)
      const cloudNotes = createNotesFromBackupDocument(document)
      const localNotes = await getAllNotes()
      const plan = await buildRestorePlan(localNotes, cloudNotes)
      const nextPreview: CloudRestorePreview = {
        createdAt: document.createdAt,
        noteCount: document.noteCount,
        plan,
        counts: countPlan(plan),
        gistId: content.gistId,
        revision: content.revision,
        gistUpdatedAt: content.updatedAt,
      }
      documentRef.current = document
      setPreview(nextPreview)
      return nextPreview
    } finally {
      setPreparing(false)
    }
  }, [])

  const apply = useCallback(async () => {
    const document = documentRef.current
    const currentPreview = preview
    if (!document || !currentPreview) {
      throw new CloudApiError(
        'RESTORE_NOT_READY',
        'Review the cloud restore preview before applying it.',
      )
    }
    setApplying(true)
    setResult(null)
    try {
      return await withExclusiveRestoreLock(async () => {
        const cloudNotes = createNotesFromBackupDocument(document)
        const localNotes = await getAllNotes()
        const latestPlan = await buildRestorePlan(localNotes, cloudNotes)
        if (!samePlan(currentPreview.plan, latestPlan)) {
          setPreview({
            ...currentPreview,
            plan: latestPlan,
            counts: countPlan(latestPlan),
          })
          throw new CloudApiError(
            'LOCAL_DATA_CHANGED',
            'Local notes changed. Review the updated restore preview before applying it.',
          )
        }
        const notesToApply = getNotesToApply(latestPlan)
        try {
          if (notesToApply.length > 0) {
            await applyNotesTransaction(notesToApply)
          }
        } catch {
          const failedResult = countPlan(latestPlan, notesToApply.length)
          setResult(failedResult)
          throw new CloudRestoreApplyError(failedResult)
        }
        const counts = countPlan(latestPlan)
        setResult(counts)
        return counts
      })
    } finally {
      setApplying(false)
    }
  }, [preview])

  return {
    downloading,
    preparing,
    applying,
    preview,
    result,
    download,
    prepare,
    apply,
    clear,
  }
}
