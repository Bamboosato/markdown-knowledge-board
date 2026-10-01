import { createBackupDocument } from './backup'
import {
  encryptBackupDocument,
  parseEncryptedBackupEnvelope,
  decryptBackupEnvelope,
  serializeEncryptedBackupEnvelope,
  validateNewBackupPassphrase,
  MAX_ENCRYPTED_BACKUP_BYTES,
} from './cloudCrypto'
import { buildRestorePlan, createNotesFromBackupDocument, getNotesToApply } from './cloudRestore'
import { applyNotesTransaction, getAllNotes } from './db'
import {
  createDriveText,
  downloadDriveBytes,
  ensureWritableFolder,
  findBackupFolders,
  findExportFiles,
  getDriveAccount,
  getDriveFile,
  getOrCreateBackupFolder,
  listBackupFiles,
  listDriveFiles,
  updateDriveText,
  type DriveFile,
} from './googleDrive'
import type { Note } from './types'

export async function createGoogleBackup(token: string, accountId: string, passphrase: string, confirmation: string, preferredFolderId?: string) {
  const normalized = validateNewBackupPassphrase(passphrase, confirmation)
  if ((await getDriveAccount(token)).id !== accountId) throw new Error('The Google account changed. Connect again.')
  const notes = (await getAllNotes()).sort((a, b) => a.id.localeCompare(b.id))
  const document = createBackupDocument(notes, new Date().toISOString())
  const content = serializeEncryptedBackupEnvelope(await encryptBackupDocument(document, normalized))
  if (content.byteLength > MAX_ENCRYPTED_BACKUP_BYTES) {
    throw new Error('The encrypted backup exceeds the 4.5 MB application limit.')
  }
  const folder = await getOrCreateBackupFolder(token, preferredFolderId)
  const operationId = crypto.randomUUID()
  const name = `mkb-backup-${document.createdAt.replace(/[:.]/g, '-')}-${operationId.slice(0, 8)}.json`
  try {
    const file = await createDriveText(token, {
      name,
      mimeType: 'application/json',
      parents: [folder.id],
      appProperties: { mkbKind: 'backup', mkbOperation: operationId },
    }, content)
    return { file, noteCount: notes.length }
  } catch (error) {
    // A lost response can follow a successful write. Resolve it before reporting failure.
    try {
      const matches = await listDriveFiles(token,
        `'${folder.id}' in parents and appProperties has { key='mkbOperation' and value='${operationId}' }`)
      if (matches.length === 1) return { file: matches[0], noteCount: notes.length }
    } catch { /* Preserve the original error when verification is unavailable. */ }
    throw error
  }
}

export async function getGoogleBackups(token: string, preferredFolderId?: string): Promise<{ folder: DriveFile | null; files: DriveFile[] }> {
  const folders = await findBackupFolders(token)
  if (folders.length > 1 && !preferredFolderId) throw new Error('Several MKB Backups folders were found. Select the folder to restore from.')
  const folder = preferredFolderId ? folders.find(item => item.id === preferredFolderId) : folders[0]
  if (preferredFolderId && !folder) throw new Error('The selected MKB Backups folder is no longer available.')
  if (!folder) return { folder: null, files: [] }
  return { folder, files: await listBackupFiles(token, folder.id) }
}

export async function prepareGoogleRestore(token: string, folderId: string, fileId: string, passphrase: string) {
  const file = await getDriveFile(token, fileId)
  if (!file.parents?.includes(folderId) || file.appProperties?.mkbKind !== 'backup') {
    throw new Error('The selected file is no longer an MKB backup in this folder.')
  }
  const content = await downloadDriveBytes(token, fileId, MAX_ENCRYPTED_BACKUP_BYTES)
  const envelope = parseEncryptedBackupEnvelope(content)
  const document = await decryptBackupEnvelope(envelope, passphrase)
  const cloudNotes = createNotesFromBackupDocument(document)
  const plan = await buildRestorePlan(await getAllNotes(), cloudNotes)
  return { document, plan, file }
}

export async function applyGoogleRestore(document: Awaited<ReturnType<typeof prepareGoogleRestore>>['document'], expectedPlan: Awaited<ReturnType<typeof prepareGoogleRestore>>['plan']) {
  const latest = await buildRestorePlan(await getAllNotes(), createNotesFromBackupDocument(document))
  const identity = (items: typeof latest) => items.map(item => [item.id, item.action, item.reason, item.localUpdatedAt, item.cloudUpdatedAt])
  if (JSON.stringify(identity(latest)) !== JSON.stringify(identity(expectedPlan))) {
    throw new Error('Local notes changed. Review the restore preview again.')
  }
  const toApply = getNotesToApply(latest)
  if (toApply.length) await applyNotesTransaction(toApply)
  return latest
}

const EXPORT_REVISIONS_KEY = 'mkb.google-export-revisions.v1'
type RevisionMap = Record<string, string>

function readRevisions(): RevisionMap {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(EXPORT_REVISIONS_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as RevisionMap : {}
  } catch { return {} }
}

export async function exportNoteToDrive(options: {
  token: string
  accountId: string
  folderId: string
  note: Note
  name: string
  content: string
  confirmOverwrite: (message: string) => boolean
}) {
  const { token, accountId, folderId, note, name, content, confirmOverwrite } = options
  if ((await getDriveAccount(token)).id !== accountId) throw new Error('The Google account changed. Connect again.')
  await ensureWritableFolder(token, folderId)
  const matches = await findExportFiles(token, folderId, note.id)
  if (matches.length > 1) throw new Error('Multiple Markdown files match this note. Resolve the duplicates in Google Drive before exporting.')
  const existing = matches[0]
  const key = `${accountId}:${folderId}:${note.id}`
  const revisions = readRevisions()
  if (!existing) {
    const created = await createDriveText(token, {
      name,
      mimeType: 'text/markdown',
      parents: [folderId],
      appProperties: { mkbKind: 'markdown', mkbNoteId: note.id },
    }, content)
    if (created.md5Checksum) {
      revisions[key] = created.md5Checksum
      try { localStorage.setItem(EXPORT_REVISIONS_KEY, JSON.stringify(revisions)) } catch { /* Still exported. */ }
    }
    return { file: created, created: true }
  }
  const current = await getDriveFile(token, existing.id)
  if (!current.parents?.includes(folderId) || current.appProperties?.mkbNoteId !== note.id || current.capabilities?.canEdit === false) {
    throw new Error('The previous Markdown file moved or cannot be edited. Choose another folder.')
  }
  if (!current.md5Checksum || revisions[key] !== current.md5Checksum) {
    if (!confirmOverwrite('This Drive file may have changed outside the app. Replace its content?')) {
      throw new Error('Markdown export cancelled.')
    }
  }
  const updated = await updateDriveText(token, existing.id, name, content)
  if (updated.md5Checksum) {
    revisions[key] = updated.md5Checksum
    try { localStorage.setItem(EXPORT_REVISIONS_KEY, JSON.stringify(revisions)) } catch { /* Still exported. */ }
  }
  return { file: updated, created: false }
}
