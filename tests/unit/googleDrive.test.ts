import { afterEach, describe, expect, it, vi } from 'vitest'
import { findBackupFolders, getOrCreateBackupFolder, listDriveFiles } from '../../src/lib/googleDrive'
import { createGoogleBackup, exportNoteToDrive, getGoogleBackups } from '../../src/lib/googleDriveOperations'
import type { Note } from '../../src/lib/types'
import { getAllNotes } from '../../src/lib/db'

vi.mock('../../src/lib/db', () => ({ getAllNotes: vi.fn(), applyNotesTransaction: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

describe('Google Drive file selection', () => {
  it('paginates and identifies a renamed managed backup folder by metadata', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const pageToken = new URL(url).searchParams.get('pageToken')
      return Response.json(pageToken
        ? { files: [{ id: 'folder-b', name: 'Renamed', mimeType: 'application/vnd.google-apps.folder', appProperties: { mkbKind: 'backup-folder' } }] }
        : { files: [{ id: 'unrelated', name: 'MKB Backups', mimeType: 'application/vnd.google-apps.folder' }], nextPageToken: 'next' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(findBackupFolders('token')).resolves.toEqual([
      expect.objectContaining({ id: 'folder-b', name: 'Renamed' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not return an inaccessible or trashed file as a match when the server returns no rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ files: [] })))
    await expect(listDriveFiles('token', "name = 'MKB Backups'")).resolves.toEqual([])
  })

  it('requires an explicit choice when two managed backup folders exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const query = new URL(url).searchParams.get('q') || ''
      if (query.includes("backup-folder")) {
        return Response.json({ files: [
          { id: 'folder-a', name: 'MKB Backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { mkbKind: 'backup-folder' } },
          { id: 'folder-b', name: 'Renamed', mimeType: 'application/vnd.google-apps.folder', appProperties: { mkbKind: 'backup-folder' } },
        ] })
      }
      return Response.json({ files: [] })
    }))
    await expect(getOrCreateBackupFolder('token')).rejects.toThrow('Several MKB Backups folders')
    await expect(getGoogleBackups('token')).rejects.toThrow('Select the folder')
    await expect(getOrCreateBackupFolder('token', 'folder-b')).resolves.toMatchObject({ id: 'folder-b' })
    await expect(getGoogleBackups('token', 'folder-b')).resolves.toMatchObject({ folder: { id: 'folder-b' }, files: [] })
  })
})

describe('Markdown export safeguards', () => {
  const note = { id: 'note-1', title: 'Memo', body: '# Memo', tags: [], updatedAt: 1 } as Note
  it('does not overwrite a Drive file changed outside this browser without confirmation', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/about')) return Response.json({ user: { permissionId: 'account-1' } })
      if (url.includes('/files/folder-1?')) return Response.json({ id: 'folder-1', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } })
      if (url.includes('/files/file-1?')) return Response.json({ id: 'file-1', mimeType: 'text/markdown', parents: ['folder-1'], md5Checksum: 'external', appProperties: { mkbKind: 'markdown', mkbNoteId: note.id }, capabilities: { canEdit: true } })
      if (url.includes('/files?') && init?.method !== 'PATCH') return Response.json({ files: [{ id: 'file-1', mimeType: 'text/markdown', parents: ['folder-1'], appProperties: { mkbKind: 'markdown', mkbNoteId: note.id } }] })
      throw new Error('Unexpected write')
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const confirmOverwrite = vi.fn(() => false)
    await expect(exportNoteToDrive({ token: 'token', accountId: 'account-1', folderId: 'folder-1', note, name: 'Memo.md', content: '# Memo', confirmOverwrite }))
      .rejects.toThrow('cancelled')
    expect(confirmOverwrite).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'PATCH')).toBe(false)
  })

  it('blocks a write when the connected account differs from the account selected in the UI', async () => {
    const fetchMock = vi.fn(async () => Response.json({ user: { permissionId: 'account-2' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(exportNoteToDrive({ token: 'token', accountId: 'account-1', folderId: 'folder-1', note, name: 'Memo.md', content: '# Memo', confirmOverwrite: () => true }))
      .rejects.toThrow('account changed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('encrypted Google Drive backup', () => {
  it('creates the fixed folder and sends encrypted content without plaintext notes', async () => {
    vi.mocked(getAllNotes).mockResolvedValue([{ id: 'note-1', title: 'Private', body: 'confidential-content-marker', tags: [], updatedAt: 1 } as Note])
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (url.includes('/about?')) return Response.json({ user: { permissionId: 'account-1' } })
      if (url.includes('/drive/v3/files?') && !url.includes('/upload/') && !init?.method) return Response.json({ files: [] })
      if (url.includes('/drive/v3/files?') && !url.includes('/upload/') && init?.method === 'POST') {
        return Response.json({ id: 'folder-1', name: 'MKB Backups', mimeType: 'application/vnd.google-apps.folder' })
      }
      if (url.includes('/upload/drive/v3/files?') && init?.method === 'POST') {
        return Response.json({ id: 'backup-1', name: 'mkb-backup.json', mimeType: 'application/json', parents: ['folder-1'] })
      }
      throw new Error('Unexpected request')
    }))
    const result = await createGoogleBackup('token', 'account-1', 'a long backup passphrase', 'a long backup passphrase')
    expect(result.noteCount).toBe(1)
    expect(result.file.id).toBe('backup-1')
    const folderRequest = requests.find(item => item.url.includes('/drive/v3/files?') && item.init?.method === 'POST')
    expect(JSON.stringify(JSON.parse(folderRequest?.init?.body as string))).toContain('MKB Backups')
    const upload = requests.find(item => item.url.includes('/upload/drive/v3/files?'))
    const body = await (upload?.init?.body as Blob).text()
    expect(body).toContain('mkbKind')
    expect(body).not.toContain('confidential-content-marker')
  })
})
