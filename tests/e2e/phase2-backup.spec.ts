import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoHorizontalOverflow } from './dialog-layout'
import { expectBodyEditorValue } from './body-editor'

const csrfToken = 'a'.repeat(43)
const revisionA = 'a'.repeat(40)
const revisionB = 'b'.repeat(40)

function success<T>(data: T) {
  return JSON.stringify({ ok: true, data, requestId: 'e2e-backup-request' })
}

function failure(code: string, message: string, status = 409) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: false,
      error: { code, message, retryable: false, stage: 'backup-upload' },
      requestId: 'e2e-backup-request',
    }),
  }
}

function backupMetadata(gistId: string, revision = revisionA) {
  return {
    gistId,
    revision,
    updatedAt: '2026-08-03T05:00:00.000Z',
    htmlUrl: `https://gist.github.com/octocat/${gistId}`,
    encryptedSize: 1024,
  }
}

async function stubSignedInSession(page: Page) {
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
}

async function openGitHubMenu(page: Page) {
  await page.getByRole('button', { name: 'Open application menu' }).click()
  const menu = page.getByRole('menu', { name: 'Application menu' })
  await menu.getByRole('menuitem', { name: 'GitHub', exact: true }).click()
  return menu
}

async function createDraft(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: /new note/i }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Body').fill(body)
}

async function submitPassphrase(page: Page, value = 'correct horse battery staple') {
  const dialog = page.getByRole('dialog', { name: 'Encrypt Cloud Backup' })
  await dialog.getByLabel('Passphrase', { exact: true }).fill(value)
  await dialog.getByLabel('Confirm passphrase').fill(value)
  await dialog.getByRole('button', { name: 'Encrypt and Back Up' }).click()
}

test.describe('Phase 2 encrypted Gist backup', () => {
  test('saves a dirty note, encrypts locally, and explicitly creates a secret backup', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await stubSignedInSession(page)
    let uploadedBody = ''
    let uploadHeaders: Record<string, string> = {}
    let createCalls = 0
    await page.route(/\/api\/cloud-backups(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success({ status: 'none' }),
        })
        return
      }
      createCalls += 1
      uploadedBody = route.request().postData() ?? ''
      uploadHeaders = route.request().headers()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: success({
          gistId: 'a1',
          revision: revisionA,
          updatedAt: '2026-08-03T05:01:00.000Z',
          encryptedSize: new TextEncoder().encode(uploadedBody).byteLength,
          sha256: 's'.repeat(43),
        }),
      })
    })

    await page.goto('/?cloudTest=1&auth=connected')
    await createDraft(page, 'Private project note', 'Never send this plaintext')
    const menu = await openGitHubMenu(page)
    await expect(
      menu.getByText(
        'GitHub connected. Backup and restore run only when you choose them.',
      ),
    ).toBeVisible()
    const backupItem = menu.getByRole('menuitem', { name: 'Cloud Backup' })
    await expect(backupItem).toBeEnabled()
    await backupItem.click()

    const saveDialog = page.getByRole('dialog', {
      name: 'Save changes before cloud backup?',
    })
    await expect(saveDialog).toContainText(
      'Cloud backup uses the saved notes in this browser.',
    )
    await expectNoHorizontalOverflow(saveDialog, 'backup save confirmation')
    await saveDialog.getByRole('button', { name: 'Save and Continue' }).click()

    const passphraseDialog = page.getByRole('dialog', {
      name: 'Encrypt Cloud Backup',
    })
    await expectNoHorizontalOverflow(passphraseDialog, 'backup passphrase')
    await passphraseDialog.getByLabel('Passphrase', { exact: true }).fill('12345678901')
    await passphraseDialog.getByLabel('Confirm passphrase').fill('12345678901')
    await passphraseDialog.getByRole('button', { name: 'Encrypt and Back Up' }).click()
    await expect(passphraseDialog).toContainText('at least 12 characters')
    expect(createCalls).toBe(0)

    await passphraseDialog
      .getByLabel('Passphrase', { exact: true })
      .fill('correct horse battery staple')
    await passphraseDialog
      .getByLabel('Confirm passphrase')
      .fill('correct horse battery staple')
    await passphraseDialog.getByRole('button', { name: 'Encrypt and Back Up' }).click()

    await expect(
      page.getByText(
        'Cloud backup completed. 1 note was encrypted and saved to GitHub.',
      ),
    ).toBeVisible()
    await expect(
      page.getByText(
        'GitHub connected. Backup and restore run only when you choose them.',
      ),
    ).toHaveCount(0)
    expect(createCalls).toBe(1)
    expect(uploadHeaders['content-type']).toBe(
      'application/vnd.mkb.encrypted-backup+json',
    )
    expect(uploadHeaders['x-csrf-token']).toBe(csrfToken)
    expect(uploadHeaders['x-mkb-operation-id']).toMatch(
      /^[0-9a-f-]{36}$/,
    )
    expect(uploadHeaders['x-mkb-content-sha256']).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(uploadedBody).not.toContain('Private project note')
    expect(uploadedBody).not.toContain('Never send this plaintext')
    expect(JSON.parse(uploadedBody)).toMatchObject({
      app: 'markdown-knowledge-board',
      envelopeVersion: 1,
      crypto: { algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256' },
    })
    await expect(page.getByLabel('Title')).toHaveValue('Private project note')
    await expectBodyEditorValue(page.getByLabel('Body'), 'Never send this plaintext')

    const metadata = await page.evaluate(() =>
      localStorage.getItem('mkb.cloud-backup.v1'),
    )
    expect(metadata).toContain('"gistId":"a1"')
    expect(metadata).not.toContain('correct horse battery staple')
    expect(metadata).not.toContain('ciphertext')
    expect(metadata).not.toContain('ghu_')
  })

  test('replaces stale connected state with reauthorization when cloud access expires', async ({
    page,
  }) => {
    await stubSignedInSession(page)
    let discoveryCalls = 0
    await page.route(/\/api\/cloud-backups(?:\?.*)?$/, async (route) => {
      discoveryCalls += 1
      await route.fulfill(
        discoveryCalls === 1
          ? {
              status: 200,
              contentType: 'application/json',
              body: success({ status: 'none' }),
            }
          : failure(
              'REAUTH_REQUIRED',
              'GitHub sign-in has expired. Sign in again.',
              401,
            ),
      )
    })

    await page.goto('/?cloudTest=1')
    const menu = await openGitHubMenu(page)
    await expect(menu.getByText('Connected as @octocat')).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()

    await expect(menu.getByText('Reauthorization required.')).toBeVisible()
    await expect(
      menu.getByRole('menuitem', { name: 'Sign in with GitHub' }),
    ).toBeVisible()
    await expect(menu.getByText('Connected as @octocat')).toHaveCount(0)
  })

  test('refreshes stale none discovery and updates a backup created from another Origin', async ({
    page,
  }) => {
    await stubSignedInSession(page)
    let remoteExists = false
    let discoveryCalls = 0
    let createCalls = 0
    let updateCalls = 0
    let updateHeaders: Record<string, string> = {}
    await page.route(/\/api\/cloud-backups(?:\/update)?(?:\?.*)?$/, async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        discoveryCalls += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success(
            remoteExists
              ? { status: 'selected', backup: backupMetadata('a1', revisionB) }
              : { status: 'none' },
          ),
        })
        return
      }
      if (method === 'PUT') {
        updateCalls += 1
        updateHeaders = route.request().headers()
        const encryptedSize = new TextEncoder().encode(
          route.request().postData() ?? '',
        ).byteLength
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success({
            ...backupMetadata('a1', revisionA),
            encryptedSize,
            sha256: 's'.repeat(43),
          }),
        })
        return
      }
      createCalls += 1
      await route.fulfill(
        failure(
          'GIST_SELECTION_REQUIRED',
          'An existing cloud backup must be selected before uploading.',
        ),
      )
    })

    await page.goto('/?cloudTest=1')
    await expect.poll(() => discoveryCalls).toBeGreaterThan(0)
    const callsBeforeRemoteChange = discoveryCalls
    remoteExists = true
    await createDraft(page, 'URL1 note', 'Back up this Origin')
    await page.getByRole('button', { name: /^Save$/ }).click()

    const menu = await openGitHubMenu(page)
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()
    await expect.poll(() => discoveryCalls).toBeGreaterThan(callsBeforeRemoteChange)
    await submitPassphrase(page)

    await expect(
      page.getByText(
        'Cloud backup completed. 1 note was encrypted and saved to GitHub.',
      ),
    ).toBeVisible()
    expect(createCalls).toBe(0)
    expect(updateCalls).toBe(1)
    expect(updateHeaders['x-mkb-expected-revision']).toBe(revisionB)
  })

  test('recovers without reloading when another Origin creates a backup during passphrase entry', async ({
    page,
  }) => {
    await stubSignedInSession(page)
    let remoteExists = false
    let blockedCreateCalls = 0
    let updateCalls = 0
    await page.route(/\/api\/cloud-backups(?:\/update)?(?:\?.*)?$/, async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success(
            remoteExists
              ? { status: 'selected', backup: backupMetadata('a1', revisionB) }
              : { status: 'none' },
          ),
        })
        return
      }
      if (method === 'POST') {
        blockedCreateCalls += 1
        await route.fulfill(
          failure(
            'GIST_SELECTION_REQUIRED',
            'An existing cloud backup must be selected before uploading.',
          ),
        )
        return
      }
      updateCalls += 1
      const encryptedSize = new TextEncoder().encode(
        route.request().postData() ?? '',
      ).byteLength
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: success({
          ...backupMetadata('a1', revisionA),
          encryptedSize,
          sha256: 's'.repeat(43),
        }),
      })
    })

    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Concurrent URL1 note', 'Keep this local content')
    await page.getByRole('button', { name: /^Save$/ }).click()
    let menu = await openGitHubMenu(page)
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Encrypt Cloud Backup' }),
    ).toBeVisible()

    remoteExists = true
    await submitPassphrase(page)
    const blockedDialog = page.getByRole('dialog', { name: 'Encrypt Cloud Backup' })
    await expect(blockedDialog).toContainText(
      'An existing cloud backup must be selected before uploading.',
    )
    await blockedDialog.getByRole('button', { name: 'Cancel' }).click()

    menu = await openGitHubMenu(page)
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()
    await submitPassphrase(page)

    await expect(
      page.getByText(
        'Cloud backup completed. 1 note was encrypted and saved to GitHub.',
      ),
    ).toBeVisible()
    expect(blockedCreateCalls).toBe(1)
    expect(updateCalls).toBe(1)
  })

  test('requires a strong warning before replacing an existing backup with zero local notes', async ({
    page,
  }) => {
    await stubSignedInSession(page)
    let updateCalls = 0
    await page.route(/\/api\/cloud-backups(?:\/update)?(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success({ status: 'selected', backup: backupMetadata('a1') }),
        })
      } else {
        updateCalls += 1
        await route.abort()
      }
    })
    await page.goto('/?cloudTest=1')
    const menu = await openGitHubMenu(page)
    const backupItem = menu.getByRole('menuitem', { name: 'Cloud Backup' })
    await expect(backupItem).toBeEnabled()
    await backupItem.click()

    const warning = page.getByRole('dialog', {
      name: 'Replace the cloud backup with an empty backup?',
    })
    await expect(warning).toContainText(
      'The existing cloud backup contains data. This action cannot be undone from this app.',
    )
    await expectNoHorizontalOverflow(warning, 'empty backup warning')
    await warning.getByRole('button', { name: 'Cancel' }).click()
    expect(updateCalls).toBe(0)
  })

  test('shows every matching Gist and waits for an explicit selection', async ({ page }) => {
    await stubSignedInSession(page)
    let selectedGistId: string | null = null
    await page.route(/\/api\/cloud-backups(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url())
      const selected = url.searchParams.get('gistId')
      if (selected) {
        selectedGistId = selected
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success({
            status: 'selected',
            backup: backupMetadata(selected, revisionB),
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: success({
          status: 'selection-required',
          candidates: [backupMetadata('a1'), backupMetadata('b2', revisionB)],
        }),
      })
    })
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Saved candidate note', 'Candidate body')
    await page.getByRole('button', { name: /^Save$/ }).click()
    const menu = await openGitHubMenu(page)
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()

    const selection = page.getByRole('dialog', { name: 'Select Cloud Backup' })
    await expectNoHorizontalOverflow(selection, 'backup selection')
    const candidates = selection.locator('.cloud-backup-candidate')
    await expect(candidates).toHaveCount(2)
    expect(selectedGistId).toBeNull()
    await candidates.nth(1).click()
    await expect(page.getByRole('dialog', { name: 'Encrypt Cloud Backup' })).toBeVisible()
    expect(selectedGistId).toBe('b2')
  })

  test('does not silently overwrite when the remote revision changes', async ({ page }) => {
    await stubSignedInSession(page)
    let latestRevision = revisionA
    let updateCalls = 0
    await page.route(/\/api\/cloud-backups(?:\/update)?(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: success({
            status: 'selected',
            backup: backupMetadata('a1', latestRevision),
          }),
        })
        return
      }
      updateCalls += 1
      latestRevision = revisionB
      await route.fulfill(
        failure(
          'REMOTE_REVISION_CHANGED',
          'The cloud backup changed on another device.',
        ),
      )
    })
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Conflict note', 'Keep local content')
    await page.getByRole('button', { name: /^Save$/ }).click()
    const menu = await openGitHubMenu(page)
    await menu.getByRole('menuitem', { name: 'Cloud Backup' }).click()
    await submitPassphrase(page)

    const conflict = page.getByRole('dialog', { name: 'Cloud Backup Changed' })
    await expect(conflict).toContainText('It was not overwritten.')
    await expectNoHorizontalOverflow(conflict, 'backup revision conflict')
    expect(updateCalls).toBe(1)
    await conflict.getByRole('button', { name: 'Replace Cloud Backup' }).click()
    await expect(page.getByRole('dialog', { name: 'Encrypt Cloud Backup' })).toBeVisible()
    expect(updateCalls).toBe(1)
    await expectBodyEditorValue(page.getByLabel('Body'), 'Keep local content')
  })
})
