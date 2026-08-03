import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createBackupDocument } from '../../src/lib/backup'
import {
  encryptBackupDocument,
  serializeEncryptedBackupEnvelope,
} from '../../src/lib/cloudCrypto'
import { sha256Base64Url } from '../../src/lib/cloudApi'
import type { Note } from '../../src/lib/types'

const passphrase = 'correct horse battery staple'
const csrfToken = 'a'.repeat(43)
const revision = 'a'.repeat(40)
const gistUpdatedAt = '2026-08-03T05:00:00.000Z'
const contentType = 'application/vnd.mkb.encrypted-backup+json'

function success<T>(data: T) {
  return JSON.stringify({ ok: true, data, requestId: 'e2e-restore-request' })
}

async function encryptedBackup(notes: Note[]) {
  const document = createBackupDocument(notes, '2026-08-03T04:00:00.000Z')
  const envelope = await encryptBackupDocument(document, passphrase)
  const content = serializeEncryptedBackupEnvelope(envelope)
  return { content, sha256: await sha256Base64Url(content) }
}

async function stubSignedInRestore(page: Page, notes: Note[]) {
  const backup = await encryptedBackup(notes)
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: success({
        status: 'signed-in',
        user: {
          id: 123,
          login: 'octocat',
          avatarUrl: 'https://example.test/avatar',
        },
        accessTokenExpiresAt: '2026-08-03T13:00:00.000Z',
        csrfToken,
      }),
    })
  })
  await page.route('**/api/cloud-backups/content?gistId=a1', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(backup.content.byteLength),
        'X-MKB-Gist-Id': 'a1',
        'X-MKB-Revision': revision,
        'X-MKB-Gist-Updated-At': gistUpdatedAt,
        'X-MKB-Content-SHA256': backup.sha256,
        'Cache-Control': 'no-store',
      },
      body: Buffer.from(backup.content),
    })
  })
  await page.route(/\/api\/cloud-backups(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: success({
        status: 'selected',
        backup: {
          gistId: 'a1',
          revision,
          updatedAt: gistUpdatedAt,
          htmlUrl: 'https://gist.github.com/octocat/a1',
          encryptedSize: backup.content.byteLength,
        },
      }),
    })
  })
}

async function openApplicationMenu(page: Page) {
  await page.getByRole('button', { name: 'Open application menu' }).click()
  return page.getByRole('menu', { name: 'Application menu' })
}

async function beginRestore(page: Page) {
  const menu = await openApplicationMenu(page)
  const restore = menu.getByRole('menuitem', { name: 'Restore from Cloud' })
  await expect(restore).toBeEnabled()
  await restore.click()
  return page.getByRole('dialog', { name: 'Decrypt Cloud Backup' })
}

async function submitRestorePassphrase(page: Page, value: string) {
  const dialog = page.getByRole('dialog', { name: 'Decrypt Cloud Backup' })
  await dialog.getByLabel('Passphrase', { exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Decrypt Backup' }).click()
}

async function expectCount(
  dialog: Locator,
  label: string,
  value: number,
) {
  const row = dialog.locator('dl div').filter({ hasText: label })
  await expect(row.locator('dd')).toHaveText(String(value))
}

async function seedNote(page: Page, note: Note) {
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('markdown-knowledge-board', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('notes')) {
          request.result.createObjectStore('notes', { keyPath: 'id' })
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const transaction = request.result.transaction('notes', 'readwrite')
        transaction.objectStore('notes').put(value)
        transaction.oncomplete = () => {
          request.result.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, note)
}

async function readNote(page: Page, id: string): Promise<Note | undefined> {
  return page.evaluate(async (noteId) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('markdown-knowledge-board', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const get = request.result.transaction('notes').objectStore('notes').get(noteId)
        get.onsuccess = () => {
          request.result.close()
          resolve(get.result)
        }
        get.onerror = () => reject(get.error)
      }
    })
  }, id)
}

test.describe('Phase 2 safe cloud restore', () => {
  test('downloads explicitly, prompts for dirty data only before apply, and retains local-only notes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const cloudNote: Note = {
      id: 'cloud-note',
      title: 'Restored from cloud',
      body: 'Encrypted cloud body',
      tags: ['cloud'],
      updatedAt: Date.UTC(2026, 7, 3, 3, 0, 0),
    }
    await stubSignedInRestore(page, [cloudNote])
    await page.goto('/?cloudTest=1')
    await page.getByRole('button', { name: /new note/i }).click()
    await page.getByLabel('Title').fill('Unsaved local note')
    await page.getByLabel('Body').fill('Must be saved before apply')

    await beginRestore(page)
    await expect(
      page.getByRole('dialog', { name: 'Save changes before cloud restore?' }),
    ).toHaveCount(0)
    await submitRestorePassphrase(page, passphrase)

    const preview = page.getByRole('dialog', { name: 'Review Cloud Restore' })
    await expectCount(preview, 'Added', 1)
    await expectCount(preview, 'Conflicted', 0)
    await preview.getByRole('button', { name: 'Apply Safe Merge' }).click()

    const saveDialog = page.getByRole('dialog', {
      name: 'Save changes before cloud restore?',
    })
    await saveDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(preview).toBeVisible()

    await preview.getByRole('button', { name: 'Apply Safe Merge' }).click()
    await saveDialog.getByRole('button', { name: 'Save and Continue' }).click()
    const result = page.getByRole('dialog', { name: 'Cloud Restore Complete' })
    await expectCount(result, 'Added', 1)
    await expectCount(result, 'Failed', 0)
    await result.getByRole('button', { name: 'Close' }).click()

    await expect(page.getByText('Restored from cloud')).toBeVisible()
    await expect(page.getByLabel('Title')).toHaveValue('Unsaved local note')
    const restored = await readNote(page, 'cloud-note')
    expect(restored).toMatchObject({
      id: cloudNote.id,
      title: cloudNote.title,
      tags: cloudNote.tags,
      updatedAt: cloudNote.updatedAt,
    })
    expect(restored?.body).toContain(cloudNote.body)
  })

  test('keeps IndexedDB unchanged and clears the field after a wrong passphrase', async ({ page }) => {
    const localNote: Note = {
      id: 'local-note',
      title: 'Local note',
      body: 'Local body',
      tags: [],
      updatedAt: Date.UTC(2026, 7, 3, 4, 0, 0),
    }
    const cloudNote: Note = {
      id: 'cloud-note',
      title: 'Cloud note',
      body: 'Cloud body',
      tags: [],
      updatedAt: Date.UTC(2026, 7, 3, 3, 0, 0),
    }
    await stubSignedInRestore(page, [cloudNote])
    await page.goto('/?cloudTest=1')
    await seedNote(page, localNote)
    await page.reload()

    const dialog = await beginRestore(page)
    await submitRestorePassphrase(page, 'incorrect passphrase value')
    await expect(dialog).toContainText(
      'The passphrase is incorrect or the backup is damaged.',
    )
    await expect(dialog.getByLabel('Passphrase', { exact: true })).toHaveValue('')
    expect(await readNote(page, 'local-note')).toMatchObject(localNote)
    expect(await readNote(page, 'cloud-note')).toBeUndefined()
  })

  test('shows local-newer content as a conflict and never overwrites it', async ({ page }) => {
    const localNote: Note = {
      id: 'shared-note',
      title: 'Local version',
      body: 'Keep this newer local body',
      tags: ['local'],
      updatedAt: Date.UTC(2026, 7, 3, 5, 0, 0),
    }
    const cloudNote: Note = {
      id: 'shared-note',
      title: 'Cloud version',
      body: 'Older cloud body',
      tags: ['cloud'],
      updatedAt: Date.UTC(2026, 7, 3, 4, 0, 0),
    }
    await stubSignedInRestore(page, [cloudNote])
    await page.goto('/?cloudTest=1')
    await seedNote(page, localNote)
    await page.reload()

    await beginRestore(page)
    await submitRestorePassphrase(page, passphrase)
    const preview = page.getByRole('dialog', { name: 'Review Cloud Restore' })
    await expectCount(preview, 'Conflicted', 1)
    await expect(preview).toContainText('Local note is newer.')
    await preview.getByRole('button', { name: 'Apply Safe Merge' }).click()
    const result = page.getByRole('dialog', { name: 'Cloud Restore Complete' })
    await expectCount(result, 'Conflicted', 1)
    expect(await readNote(page, 'shared-note')).toMatchObject(localNote)
  })
})
