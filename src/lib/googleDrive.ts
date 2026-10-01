const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const APP_PROPERTY = 'mkbKind'
export const BACKUP_FOLDER_NAME = 'MKB Backups'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type DriveAccount = { id: string; label: string }
export type DriveFile = {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  modifiedTime?: string
  size?: string
  md5Checksum?: string
  appProperties?: Record<string, string>
  capabilities?: { canAddChildren?: boolean; canEdit?: boolean }
}

export class DriveError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

function isDriveFile(value: unknown): value is DriveFile {
  return !!value && typeof value === 'object' && typeof (value as DriveFile).id === 'string'
}

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(init.method ? 60_000 : 20_000),
    })
  } catch {
    throw new DriveError(0, 'Google Drive did not respond. Check the connection and try again.')
  }
  if (!response.ok) {
    const message = response.status === 401
      ? 'Google Drive authorization expired. Connect again.'
      : response.status === 403
        ? 'Google Drive access was denied or storage is unavailable.'
        : response.status === 404
          ? 'The Google Drive file or folder no longer exists.'
          : response.status === 429
            ? 'Google Drive is busy. Try again later.'
            : `Google Drive request failed (${response.status}).`
    throw new DriveError(response.status, message)
  }
  return response
}

export async function getDriveAccount(token: string): Promise<DriveAccount> {
  const response = await request(token, `${API}/about?fields=user(permissionId,emailAddress,displayName)`)
  const data: unknown = await response.json()
  const user = (data as { user?: { permissionId?: string; emailAddress?: string; displayName?: string } }).user
  if (!user?.permissionId) throw new Error('Google Drive did not identify the account.')
  return { id: user.permissionId, label: user.emailAddress || user.displayName || user.permissionId }
}

export async function listDriveFiles(token: string, query: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `trashed = false and (${query})`,
      fields: 'nextPageToken,files(id,name,mimeType,parents,modifiedTime,size,md5Checksum,appProperties,capabilities(canAddChildren,canEdit))',
      pageSize: '100',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await request(token, `${API}/files?${params}`)
    const data: unknown = await response.json()
    const page = data as { files?: unknown[]; nextPageToken?: string }
    files.push(...(page.files ?? []).filter(isDriveFile))
    pageToken = page.nextPageToken
  } while (pageToken)
  return files
}

export async function getDriveFile(token: string, id: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: 'id,name,mimeType,parents,modifiedTime,size,md5Checksum,appProperties,capabilities(canAddChildren,canEdit)' })
  const response = await request(token, `${API}/files/${encodeURIComponent(id)}?${params}`)
  const file: unknown = await response.json()
  if (!isDriveFile(file)) throw new Error('Google Drive returned an invalid file.')
  return file
}

async function createMetadata(token: string, metadata: object): Promise<DriveFile> {
  const response = await request(token, `${API}/files?fields=id,name,mimeType,parents,appProperties,capabilities(canAddChildren)`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  const file: unknown = await response.json()
  if (!isDriveFile(file)) throw new Error('Google Drive did not return the created file.')
  return file
}

export async function findBackupFolders(token: string): Promise<DriveFile[]> {
  const folders = await listDriveFiles(token,
    `mimeType = '${FOLDER_MIME}' and appProperties has { key='${APP_PROPERTY}' and value='backup-folder' }`)
  return folders.filter(file => file.mimeType === FOLDER_MIME && file.appProperties?.[APP_PROPERTY] === 'backup-folder')
}

export async function getOrCreateBackupFolder(token: string, preferredId?: string): Promise<DriveFile> {
  const folders = await findBackupFolders(token)
  if (preferredId) {
    const selected = folders.find(folder => folder.id === preferredId)
    if (!selected) throw new Error('The selected MKB Backups folder is no longer available.')
    return selected
  }
  if (folders.length > 1) throw new Error('Several MKB Backups folders were found. Resolve the duplicates in Google Drive before saving.')
  if (folders[0]) return folders[0]
  return createMetadata(token, {
    name: BACKUP_FOLDER_NAME,
    mimeType: FOLDER_MIME,
    parents: ['root'],
    appProperties: { [APP_PROPERTY]: 'backup-folder' },
  })
}

export async function listBackupFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const files = await listDriveFiles(token,
    `'${folderId}' in parents and appProperties has { key='${APP_PROPERTY}' and value='backup' }`)
  return files.filter(file => file.parents?.includes(folderId) && file.appProperties?.[APP_PROPERTY] === 'backup')
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))
}

export async function findExportFiles(token: string, folderId: string, noteId: string): Promise<DriveFile[]> {
  const files = await listDriveFiles(token,
    `'${folderId}' in parents and appProperties has { key='mkbNoteId' and value='${noteId.replaceAll("'", "\\'")}' }`)
  return files.filter(file => file.parents?.includes(folderId) && file.appProperties?.mkbNoteId === noteId && file.appProperties?.[APP_PROPERTY] === 'markdown')
}

export async function downloadDriveBytes(token: string, fileId: string, maxBytes: number): Promise<Uint8Array> {
  const response = await request(token, `${API}/files/${encodeURIComponent(fileId)}?alt=media`)
  const declaredSize = Number(response.headers.get('Content-Length'))
  if (declaredSize > maxBytes) throw new Error('The Google Drive file is too large.')
  if (!response.body) throw new Error('Google Drive returned an empty file response.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('The Google Drive file is too large.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

export async function createDriveText(token: string, metadata: { mimeType: string } & Record<string, unknown>, content: string | Uint8Array): Promise<DriveFile> {
  const boundary = `mkb_${crypto.randomUUID().replaceAll('-', '')}`
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${metadata.mimeType}; charset=UTF-8\r\n\r\n`,
    typeof content === 'string' ? content : Uint8Array.from(content).buffer,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` })
  const response = await request(token, `${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,parents,modifiedTime,size,md5Checksum,appProperties`, {
    method: 'POST', body,
  })
  const file: unknown = await response.json()
  if (!isDriveFile(file)) throw new Error('Google Drive did not return the created file.')
  return file
}

export async function updateDriveText(token: string, fileId: string, name: string, content: string): Promise<DriveFile> {
  const boundary = `mkb_${crypto.randomUUID().replaceAll('-', '')}`
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name })}\r\n`,
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` })
  const response = await request(token, `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,mimeType,parents,modifiedTime,size,md5Checksum,appProperties`, {
    method: 'PATCH', body,
  })
  const file: unknown = await response.json()
  if (!isDriveFile(file)) throw new Error('Google Drive did not return the updated file.')
  return file
}

export async function ensureWritableFolder(token: string, folderId: string): Promise<DriveFile> {
  const folder = await getDriveFile(token, folderId)
  if (folder.mimeType !== FOLDER_MIME || folder.capabilities?.canAddChildren === false) {
    throw new Error('Choose a Google Drive folder where files can be added.')
  }
  return folder
}
