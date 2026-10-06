import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'

const csrfToken = 'a'.repeat(43)

/**
 * Test viewpoints before cases:
 * - Functional: loaded-app local edit/save/export/backup/import continues offline;
 *   reconnect requires an explicit retry and never starts backup/restore.
 * - Non-functional: cloud requests are isolated from offline local work and dialogs
 *   remain keyboard-operable without timing-dependent retries.
 * - Data: IndexedDB, Markdown export, JSON roundtrip, and imported Markdown retain
 *   their content while no encrypted Gist mutation is attempted.
 * - UI: 390 x 844 menu/dialog/result boundaries, initial focus, focus containment,
 *   focus return, live status, and passphrase visibility state are exposed.
 * - Normal/error/boundary/state: online -> offline -> online, a cloud dialog opened
 *   before disconnect, exact mobile viewport edges, and explicit Retry are separated.
 */

function success<T>(data: T) {
  return JSON.stringify({ ok: true, data, requestId: 'e2e-readiness-request' })
}

async function stubSignedInCloud(page: Page) {
  const calls = { session: 0, discovery: 0, mutation: 0 }
  await page.route('**/api/auth/session', async (route) => {
    calls.session += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: success({
        status: 'signed-in',
        user: { id: 123, login: 'octocat', avatarUrl: null },
        csrfToken,
      }),
    })
  })
  await page.route(/\/api\/cloud-backups(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      calls.discovery += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: success({ status: 'none' }),
      })
      return
    }
    calls.mutation += 1
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: success({
        gistId: 'a1',
        revision: 'a'.repeat(40),
        updatedAt: '2026-08-03T05:00:00.000Z',
        htmlUrl: 'https://gist.github.com/octocat/a1',
        encryptedSize: 128,
      }),
    })
  })
  return calls
}

async function mockBackupSavePicker(page: Page) {
  await page.addInitScript(() => {
    const target = window as Window & {
      __readinessBackupText?: string
      __readinessBackupName?: string
    }
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async (options?: { suggestedName?: string }) => {
        target.__readinessBackupName = options?.suggestedName
        return {
          createWritable: async () => ({
            write: async (blob: Blob) => {
              target.__readinessBackupText = await blob.text()
            },
            close: async () => {},
          }),
        }
      },
    })
  })
}

async function forceBackupDownloadFallback(page: Page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker')
  })
}

async function setOfflineState(
  context: BrowserContext,
  page: Page,
  browserName: string,
  offline: boolean,
) {
  if (browserName !== 'webkit') {
    await context.setOffline(offline)
    return
  }
  // Playwright WebKit cannot read an uploaded File while its context is at
  // network-level offline. Chromium/Firefox keep that stronger simulation;
  // WebKit uses the browser-standard state/event contract and request counters.
  await page.evaluate((nextOffline) => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => !nextOffline,
    })
    window.dispatchEvent(new Event(nextOffline ? 'offline' : 'online'))
  }, offline)
}

async function openApplicationMenu(page: Page) {
  await page.getByRole('button', { name: 'Open application menu' }).click()
  return page.getByRole('menu', { name: 'Application menu' })
}

async function openAppMenuSection(page: Page, section: 'Local Data' | 'GitHub') {
  const menu = await openApplicationMenu(page)
  await menu.getByRole('menuitem', { name: section, exact: true }).click()
  return menu
}

async function createSavedNote(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: /new note/i }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Body').fill(body)
  await page.getByRole('button', { name: /^Save$/ }).click()
  await expect(page.getByLabel('Editor status')).toContainText('Status: Saved')
}

async function expectInsideViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)
}

async function expectResultValue(dialog: Locator, label: string, value: string) {
  const row = dialog.locator('dl div').filter({ hasText: label })
  await expect(row.locator('dd')).toHaveText(value)
}

test.describe('Phase 2 Production readiness', () => {
  test('keeps every local data path usable offline and reconnects only after Retry', { tag: '@ci-smoke' }, async ({
    context,
    page,
    browserName,
  }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1200, height: 800 })
    const calls = await stubSignedInCloud(page)
    await forceBackupDownloadFallback(page)
    await page.goto('/?cloudTest=1')

    let menu = await openAppMenuSection(page, 'GitHub')
    await expect(menu.getByText('Connected as @octocat')).toBeVisible()
    expect(calls.session).toBe(1)
    expect(calls.discovery).toBe(1)

    await setOfflineState(context, page, browserName, true)
    await expect(menu.getByText('Offline. Local editing remains available.')).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Retry' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await createSavedNote(page, 'Offline local note', '# Offline\n\nLocal body stays')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Export Markdown', exact: true }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export Markdown', exact: true })
    await expect(exportDialog.getByRole('button', { name: 'Google Drive', exact: true })).toBeDisabled()
    await expect(exportDialog.getByRole('button', { name: 'Local', exact: true })).toBeFocused()
    await exportDialog.getByRole('button', { name: 'Local', exact: true }).click()
    const download = await downloadPromise
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()
    expect(await readFile(downloadPath!, 'utf8')).toContain('Local body stays')

    menu = await openAppMenuSection(page, 'Local Data')
    const backupDownloadPromise = page.waitForEvent('download')
    await menu.getByRole('menuitem', { name: /Backup All Notes/ }).click()
    const backupDownload = await backupDownloadPromise
    const backupDownloadPath = await backupDownload.path()
    expect(backupDownloadPath).toBeTruthy()
    const backupText = await readFile(backupDownloadPath!, 'utf8')
    const backupResult = page.getByRole('dialog', { name: 'Backup Ready' })
    await expect(backupResult).toBeVisible()
    await expect(backupResult.getByRole('button', { name: 'Close' })).toBeFocused()
    expect(backupText).toContain('Offline local note')
    await backupResult.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Open application menu' })).toBeFocused()

    const backupImportPath = testInfo.outputPath('offline-backup.json')
    await writeFile(backupImportPath, backupText)
    await page.setInputFiles('#import-backup', backupImportPath)
    const backupImportResult = page.getByRole('dialog', { name: 'Import Complete' })
    await expectResultValue(backupImportResult, 'Skipped', '1')
    await expectResultValue(backupImportResult, 'Failed', '0')
    await backupImportResult.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Open application menu' })).toBeFocused()

    const markdownImportPath = testInfo.outputPath('offline-import.md')
    await writeFile(markdownImportPath, '# Imported offline\n\nNo network required')
    await page.setInputFiles('#import-markdown', markdownImportPath)
    const markdownImportResult = page.getByRole('dialog', { name: 'Import Complete' })
    await expectResultValue(markdownImportResult, 'Added', '1')
    await expectResultValue(markdownImportResult, 'Failed', '0')
    await markdownImportResult.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Import Markdown' })).toBeFocused()
    const savedBodies = await page.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const request = indexedDB.open('markdown-knowledge-board', 1)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const getAll = request.result
              .transaction('notes', 'readonly')
              .objectStore('notes')
              .getAll()
            getAll.onerror = () => reject(getAll.error)
            getAll.onsuccess = () =>
              resolve(
                (getAll.result as Array<{ body: string }>).map((note) => note.body),
              )
          }
        }),
    )
    expect(savedBodies.some((body) => body.includes('No network required'))).toBe(true)
    expect(calls.mutation).toBe(0)

    await setOfflineState(context, page, browserName, false)
    menu = await openAppMenuSection(page, 'GitHub')
    await expect(
      menu.getByText('Connection restored. Retry to check GitHub.'),
    ).toBeVisible()
    expect(calls.session).toBe(1)
    expect(calls.mutation).toBe(0)
    await menu.getByRole('menuitem', { name: 'Retry' }).click()
    await expect(menu.getByText('Connected as @octocat')).toBeVisible()
    expect(calls.session).toBe(2)
    expect(calls.mutation).toBe(0)
  })

  test('keeps menu, passphrase, and result dialogs keyboard-safe at 390 x 844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stubSignedInCloud(page)
    await mockBackupSavePicker(page)
    await page.goto('/?cloudTest=1')

    let menu = await openAppMenuSection(page, 'GitHub')
    await expectInsideViewport(menu, page)
    await expect(menu).toHaveCSS('overflow-y', 'auto')
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()

    const passphraseDialog = page.getByRole('dialog', {
      name: 'Encrypt Cloud Backup',
    })
    await expectInsideViewport(passphraseDialog, page)
    const passphrase = passphraseDialog.getByLabel('Passphrase', { exact: true })
    await expect(passphrase).toBeFocused()
    const showPassphrase = passphraseDialog.getByRole('button', {
      name: 'Show passphrase',
    })
    await expect(showPassphrase).toHaveAttribute('data-tooltip', 'Show passphrase')
    await expect(showPassphrase).toHaveAttribute('aria-pressed', 'false')
    await showPassphrase.click()
    const hidePassphrase = passphraseDialog.getByRole('button', {
      name: 'Hide passphrase',
    })
    await expect(hidePassphrase).toHaveAttribute('aria-pressed', 'true')
    await passphrase.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(passphraseDialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(passphrase).toBeFocused()
    await page.keyboard.press('Escape')
    const menuButton = page.getByRole('button', { name: 'Open application menu' })
    await expect(menuButton).toBeFocused()

    menu = await openAppMenuSection(page, 'Local Data')
    await menu.getByRole('menuitem', { name: /Backup All Notes/ }).click()
    const result = page.getByRole('dialog', { name: 'Backup Complete' })
    await expectInsideViewport(result, page)
    const close = result.getByRole('button', { name: 'Close' })
    await expect(close).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menuButton).toBeFocused()
  })

  test('blocks a cloud upload when the network drops after its dialog opens', async ({
    context,
    page,
    browserName,
  }) => {
    const calls = await stubSignedInCloud(page)
    await page.goto('/?cloudTest=1')
    const menu = await openAppMenuSection(page, 'GitHub')
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()
    const dialog = page.getByRole('dialog', { name: 'Encrypt Cloud Backup' })
    await expect(dialog).toBeVisible()

    await setOfflineState(context, page, browserName, true)
    await dialog.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple')
    await dialog.getByLabel('Confirm passphrase').fill('correct horse battery staple')
    await dialog.getByRole('button', { name: 'Encrypt and Back Up' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('You are offline.')
    expect(calls.mutation).toBe(0)

    await setOfflineState(context, page, browserName, false)
    await expect.poll(() => calls.mutation).toBe(0)
  })
})
