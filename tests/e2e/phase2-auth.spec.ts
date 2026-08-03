import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { expectNoHorizontalOverflow } from './dialog-layout'

const csrfToken = 'a'.repeat(43)

function success<T>(data: T) {
  return JSON.stringify({
    ok: true,
    data,
    requestId: 'e2e-request-id',
  })
}

async function stubSession(
  page: Page,
  status: 'signed-out' | 'signed-in' | 'reauthorization-required' = 'signed-out',
) {
  let calls = 0
  await page.route('**/api/auth/session', async (route) => {
    calls += 1
    const data =
      status === 'signed-in'
        ? {
            status,
            user: {
              id: 123,
              login: 'octocat',
              avatarUrl: 'https://example.test/avatar',
            },
            accessTokenExpiresAt: '2026-08-03T13:00:00.000Z',
            csrfToken,
          }
        : { status, csrfToken }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: success(data),
    })
  })
  return () => calls
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

async function createDraft(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: /new note/i }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Body').fill(body)
}

async function seedCloudMetadata(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mkb.cloud-backup.v1',
      JSON.stringify({
        version: 1,
        users: {
          123: {
            gistId: 'a1',
            revision: 'a'.repeat(40),
            updatedAt: '2026-08-03T05:00:00.000Z',
            htmlUrl: 'https://gist.github.com/octocat/a1',
            encryptedSize: 1024,
            sha256: 's'.repeat(43),
          },
        },
      }),
    )
  })
}

test.describe('Phase 2 optional GitHub authentication', () => {
  test('keeps localhost local-only unless the explicit stub config is used', async ({
    page,
  }) => {
    let sessionCalls = 0
    await page.route('**/api/auth/session', async (route) => {
      sessionCalls += 1
      await route.abort()
    })
    await page.goto('/')

    const menu = await openApplicationMenu(page)
    const localData = menu.getByRole('menuitem', {
      name: 'Local Data',
      exact: true,
    })
    await expect(localData).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'GitHub', exact: true })).toHaveCount(0)
    await localData.click()
    await expect(menu.getByRole('menuitem', { name: 'Backup All Notes' })).toBeVisible()
    expect(sessionCalls).toBe(0)
  })

  test('separates Local Data and GitHub into focused menu levels', async ({
    page,
  }) => {
    await stubSession(page)
    await page.goto('/?cloudTest=1')

    const menu = await openApplicationMenu(page)
    const localData = menu.getByRole('menuitem', { name: 'Local Data', exact: true })
    const github = menu.getByRole('menuitem', { name: 'GitHub', exact: true })

    await expect(localData).toBeVisible()
    await expect(github).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Backup All Notes' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Sign in with GitHub' })).toHaveCount(0)

    await localData.click()
    await expect(menu.getByRole('menuitem', { name: 'Back to application menu' })).toBeFocused()
    await expect(menu.getByRole('menuitem', { name: 'Backup All Notes' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Sign in with GitHub' })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(localData).toBeFocused()
    await github.click()
    await expect(menu.getByRole('menuitem', { name: 'Back to application menu' })).toBeFocused()
    await expect(menu.getByRole('menuitem', { name: 'Sign in with GitHub' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Backup All Notes' })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(github).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open application menu' })).toBeFocused()
  })

  test('offers only Save and Continue or Cancel for a dirty sign-in', async ({
    page,
  }) => {
    await stubSession(page)
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Unsaved OAuth draft', 'Keep this body')

    const menu = await openAppMenuSection(page, 'GitHub')
    await menu.getByRole('menuitem', { name: 'Sign in with GitHub' }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Save changes before signing in?',
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'Signing in with GitHub leaves this page. Save your changes before continuing.',
    )
    await expectNoHorizontalOverflow(dialog, 'dirty sign-in confirmation')
    await expect(dialog.getByRole('button', { name: 'Save and Continue' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Discard/i })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Save and Continue' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Save and Continue' })).toBeFocused()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('Body')).toHaveValue('Keep this body')
    await expect(page.getByText('Status: Draft')).toBeVisible()
  })

  test('starts OAuth without a dialog when there are no unsaved changes', async ({
    page,
  }) => {
    await stubSession(page)
    let startCalls = 0
    await page.route('**/api/auth/github/start?**', async (route) => {
      startCalls += 1
      await route.fulfill({ status: 204 })
    })
    await page.goto('/?cloudTest=1')

    const menu = await openAppMenuSection(page, 'GitHub')
    await menu.getByRole('menuitem', { name: 'Sign in with GitHub' }).click()
    await expect.poll(() => startCalls).toBe(1)
    await expect(
      page.getByRole('dialog', { name: 'Save changes before signing in?' }),
    ).toHaveCount(0)
  })

  test('starts OAuth only after the dirty draft is saved successfully', async ({
    page,
  }) => {
    await stubSession(page)
    let startRequest: Route | null = null
    await page.route('**/api/auth/github/start?**', async (route) => {
      startRequest = route
      await route.fulfill({ status: 204 })
    })
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Saved before OAuth', 'Persisted body')

    const menu = await openAppMenuSection(page, 'GitHub')
    await menu.getByRole('menuitem', { name: 'Sign in with GitHub' }).click()
    await page
      .getByRole('dialog', { name: 'Save changes before signing in?' })
      .getByRole('button', { name: 'Save and Continue' })
      .click()
    await expect.poll(() => startRequest !== null).toBe(true)
    const stored = await page.evaluate(async () => {
      const request = indexedDB.open('markdown-knowledge-board', 1)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const tx = db.transaction('notes', 'readonly')
      const allRequest = tx.objectStore('notes').getAll()
      const notes = await new Promise<Array<{ title: string; body: string }>>(
        (resolve, reject) => {
          allRequest.onsuccess = () => resolve(allRequest.result)
          allRequest.onerror = () => reject(allRequest.error)
        },
      )
      db.close()
      return notes
    })
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Saved before OAuth',
          body: 'Persisted body',
        }),
      ]),
    )
  })

  test('does not start OAuth when IndexedDB save fails', async ({ page }) => {
    await page.addInitScript(() => {
      const originalPut = IDBObjectStore.prototype.put
      Object.defineProperty(IDBObjectStore.prototype, 'put', {
        configurable: true,
        value(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
          const state = window as typeof window & { __failNextNoteSave?: boolean }
          if (this.name === 'notes' && state.__failNextNoteSave) {
            state.__failNextNoteSave = false
            throw new DOMException('Injected save failure', 'UnknownError')
          }
          return originalPut.apply(this, args)
        },
      })
    })
    await stubSession(page)
    let startCalls = 0
    await page.route('**/api/auth/github/start?**', async (route) => {
      startCalls += 1
      await route.abort()
    })
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Failed save draft', 'Must remain editable')
    await page.evaluate(() => {
      ;(window as typeof window & { __failNextNoteSave?: boolean }).__failNextNoteSave =
        true
    })

    const menu = await openAppMenuSection(page, 'GitHub')
    await menu.getByRole('menuitem', { name: 'Sign in with GitHub' }).click()
    await page
      .getByRole('dialog', { name: 'Save changes before signing in?' })
      .getByRole('button', { name: 'Save and Continue' })
      .click()

    await expect(page.getByRole('dialog', { name: 'Save changes before signing in?' })).toHaveCount(0)
    await expect(page.getByLabel('Body')).toHaveValue('Must remain editable')
    await expect(page.getByText('Status: Save failed')).toBeVisible()
    expect(startCalls).toBe(0)
  })

  test('signs out without deleting the local note', async ({ page }) => {
    await stubSession(page, 'signed-in')
    await seedCloudMetadata(page)
    await page.route('**/api/auth/signout', async (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe(csrfToken)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: success({ signedOut: true }),
      })
    })
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Local note', 'Retained after sign out')
    await page.getByRole('button', { name: /^Save$/ }).click()

    const menu = await openAppMenuSection(page, 'GitHub')
    await expect(menu.getByText('Connected as @octocat')).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(menu.getByText('Signed out. Local notes were not changed.')).toBeVisible()
    await expect(page.getByLabel('Title')).toHaveValue('Local note')
    await expect(page.getByLabel('Body')).toHaveValue('Retained after sign out')
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('mkb.cloud-backup.v1')),
      )
      .toContain('"gistId":"a1"')
  })

  test('disconnects this browser while retaining local data and the Gist', async ({
    page,
  }) => {
    await stubSession(page, 'signed-in')
    await seedCloudMetadata(page)
    await page.route('**/api/auth/disconnect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: success({
          disconnected: true,
          revocation: 'failed',
          githubSettingsUrl: 'https://github.com/settings/applications',
        }),
      })
    })
    await page.goto('/?cloudTest=1')
    await createDraft(page, 'Disconnect local note', 'Local body stays')
    await page.getByRole('button', { name: /^Save$/ }).click()

    const menu = await openAppMenuSection(page, 'GitHub')
    await menu.getByRole('menuitem', { name: 'Disconnect GitHub' }).click()
    const dialog = page.getByRole('dialog', { name: 'Disconnect GitHub?' })
    await expect(dialog).toContainText(
      'Local notes and the encrypted Gist backup will not be deleted.',
    )
    await expectNoHorizontalOverflow(dialog, 'GitHub disconnect confirmation')
    await dialog.getByRole('button', { name: 'Disconnect GitHub' }).click()

    await expect(
      page.getByText(
        'This browser was disconnected, but GitHub token revocation could not be confirmed.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /Open GitHub settings/ })).toHaveAttribute(
      'href',
      'https://github.com/settings/applications',
    )
    await expect(page.getByLabel('Body')).toHaveValue('Local body stays')
    const cached = await page.evaluate(() =>
      localStorage.getItem('mkb.cloud-backup.v1'),
    )
    expect(cached).toBe('{"version":1,"users":{}}')
  })

  test('does not retry session or start cloud work automatically after reconnect', async ({
    context,
    page,
  }) => {
    const getSessionCalls = await stubSession(page, 'signed-in')
    await page.goto('/?cloudTest=1')
    await expect.poll(getSessionCalls).toBe(1)

    await context.setOffline(true)
    const menu = await openAppMenuSection(page, 'GitHub')
    await expect(menu.getByText('Offline. Local editing remains available.')).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Retry' })).toBeDisabled()
    await context.setOffline(false)
    await expect(menu.getByText('Connection restored. Retry to check GitHub.')).toBeVisible()
    expect(getSessionCalls()).toBe(1)
  })

  test('shows callback status without retaining auth query parameters', async ({ page }) => {
    await stubSession(page, 'signed-in')
    await page.goto('/?cloudTest=1&auth=connected')
    const menu = await openAppMenuSection(page, 'GitHub')
    await expect(
      menu.getByText('GitHub connected. No backup or restore was started.'),
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.has('auth')).toBe(false)
  })
})
