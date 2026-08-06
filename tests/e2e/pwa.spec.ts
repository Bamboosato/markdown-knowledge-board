import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { expectBodyEditorValue } from './body-editor'

// Test viewpoints before case detail:
// - Functional: registration, precache, offline restart, install action, and iPhone help.
// - Non-functional: cache budget is a build gate; status UI remains responsive at 390x844.
// - Data/security: IndexedDB remains the note source of truth and /api responses are never cached.
// - UI: install/offline controls are named, keyboard reachable, and restore focus.
// - Normal/abnormal/boundary/state: online->controlled->offline, prompt dismissal,
//   unsupported native prompt fallback, and offline API failure are separate cases.

async function prepareControlledPage(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
}

async function publishVersion(
  request: APIRequestContext,
  version: 'v1' | 'v2',
) {
  const response = await request.post(
    `/__pwa-test/version?value=${version}`,
  )
  expect(response.ok()).toBe(true)
}

async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    await registration.update()
  })
  await expect(page.getByText('Update available', { exact: true })).toBeVisible()
}

async function restartAndWaitForVersionTwo(page: Page) {
  const reloaded = page.waitForEvent('load')
  await page.getByRole('button', { name: 'Restart to update' }).click()
  await reloaded
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector('meta[name="pwa-test-version"]')?.getAttribute('content') ?? null,
      ),
    )
    .toBe('v2')
}

test.beforeEach(async ({ request }) => {
  await publishVersion(request, 'v1')
})

test.describe('Phase 3 PWA production-preview behavior', () => {
  test('registers the root worker and exposes the approved manifest', async ({
    page,
  }) => {
    await prepareControlledPage(page)

    const result = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      const manifest = await fetch('/manifest.webmanifest').then((response) =>
        response.json(),
      )
      return {
        scope: registration.scope,
        manifest,
        cacheKeys: await caches.keys(),
      }
    })

    expect(result.scope).toBe(new URL('/', page.url()).href)
    expect(result.manifest).toMatchObject({
      id: '/',
      name: 'Markdown Knowledge Board',
      short_name: 'Knowledge Board',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#1d1d1d',
    })
    expect(result.manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: 'icons/pwa-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: 'icons/pwa-512.png', sizes: '512x512' }),
        expect.objectContaining({
          src: 'icons/pwa-maskable-512.png',
          purpose: 'maskable',
        }),
      ]),
    )
    expect(result.cacheKeys.length).toBeGreaterThan(0)
  })

  test('restarts offline with saved local data intact', async ({ context, page }) => {
    await prepareControlledPage(page)
    await page.getByRole('button', { name: /new note/i }).click()
    await page.getByLabel('Title').fill('Offline restart note')
    await page.getByLabel('Body').fill(
      [
        '# Offline',
        '',
        'Saved before disconnect',
        '',
        '```mermaid',
        'flowchart LR',
        '  Offline --> Ready',
        '```',
        '',
        '---',
        '',
        '# Second slide',
      ].join('\n'),
    )
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.getByText('Status: Saved')).toBeVisible()
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const openRequest = indexedDB.open('markdown-knowledge-board')
        openRequest.onerror = () => reject(openRequest.error)
        openRequest.onsuccess = () => {
          const database = openRequest.result
          const transaction = database.transaction('notes', 'readwrite')
          const store = transaction.objectStore('notes')
          const readRequest = store.getAll()
          readRequest.onerror = () => reject(readRequest.error)
          readRequest.onsuccess = () => {
            const note = readRequest.result.find(
              (candidate) => candidate.title === 'Offline restart note',
            )
            if (!note) {
              reject(new Error('saved note not found'))
              return
            }
            store.put({
              ...note,
              marp: {
                enabled: true,
                theme: 'default',
                size: '16:9',
                paginate: true,
                headingDivider: false,
              },
            })
          }
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })
    })

    await page.close()
    await context.setOffline(true)
    const offlinePage = await context.newPage()
    await offlinePage.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(offlinePage.getByText('Offline', { exact: true })).toBeVisible()
    await expect(
      offlinePage.getByRole('button', { name: /Offline restart note/ }),
    ).toBeVisible()
    await offlinePage
      .getByRole('button', { name: /Offline restart note/ })
      .click()
    await expect(
      offlinePage.getByRole('img', { name: /Mermaid diagram/ }),
    ).toBeVisible({ timeout: 15_000 })
    await offlinePage.getByRole('button', { name: 'Slides' }).click()
    await expect(offlinePage.frameLocator('iframe[title="Slide preview"]').locator('body')).toBeVisible({
      timeout: 15_000,
    })
    await offlinePage.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(offlinePage.getByLabel('Title')).toHaveValue('Offline restart note')
    await expect(offlinePage.getByLabel('Body')).toBeVisible()
    await context.setOffline(false)
  })

  test('never serves an API response from Cache Storage', async ({ context, page }) => {
    await prepareControlledPage(page)
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'signed-out', sentinel: 'pwa-api-response' }),
      })
    })

    await expect(
      page.evaluate(() => fetch('/api/auth/session').then((response) => response.status)),
    ).resolves.toBe(200)
    expect(
      await page.evaluate(async () => {
        for (const cacheName of await caches.keys()) {
          const match = await caches.open(cacheName).then((cache) =>
            cache.match('/api/auth/session'),
          )
          if (match) return true
        }
        return false
      }),
    ).toBe(false)

    await page.unroute('**/api/auth/session')
    await context.setOffline(true)
    await expect(
      page.evaluate(() =>
        fetch('/api/auth/session')
          .then(() => 'unexpected-success')
          .catch(() => 'network-failure'),
      ),
    ).resolves.toBe('network-failure')
    await context.setOffline(false)
  })

  test('shows Install App only while a native prompt is available', async ({ page }) => {
    await prepareControlledPage(page)
    await page.evaluate(() => {
      const promptEvent = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
        prompt: () => Promise<void>
        userChoice: Promise<{ outcome: 'dismissed'; platform: string }>
      }
      promptEvent.prompt = async () => {
        ;(window as typeof window & { __installPromptCalled?: boolean }).__installPromptCalled =
          true
      }
      promptEvent.userChoice = Promise.resolve({
        outcome: 'dismissed',
        platform: 'test',
      })
      window.dispatchEvent(promptEvent)
    })

    await page.getByLabel('Open application menu').click()
    await page.getByRole('menuitem', { name: 'Install App' }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __installPromptCalled?: boolean })
              .__installPromptCalled,
        ),
      )
      .toBe(true)
    await expect(page.getByLabel('Open application menu')).toBeFocused()

    await page.getByLabel('Open application menu').click()
    await expect(page.getByRole('menuitem', { name: 'Install App' })).toHaveCount(0)
  })

  test('applies a clean update only after the explicit restart action', async ({
    page,
    request,
  }) => {
    await prepareControlledPage(page)
    await publishVersion(request, 'v2')
    await checkForUpdate(page)

    expect(
      await page.evaluate(
        () => document.querySelector('meta[name="pwa-test-version"]')?.getAttribute('content') ?? null,
      ),
    ).toBeNull()
    await restartAndWaitForVersionTwo(page)
  })

  test('keeps a waiting update and dirty draft after Later and Cancel', async ({
    page,
    request,
  }) => {
    await prepareControlledPage(page)
    await publishVersion(request, 'v2')
    await checkForUpdate(page)

    await page.getByRole('button', { name: 'Later' }).click()
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0)
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)),
    ).toBe(true)

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)),
    ).toBe(true)

    await page.reload()
    await expect(page.getByText('Update available', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /new note/i }).click()
    await page.getByLabel('Body').fill('Dirty draft before update')
    await page.getByRole('button', { name: 'Restart to update' }).click()
    const dialog = page.getByRole('dialog', { name: 'Update available' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expectBodyEditorValue(page.getByLabel('Body'), 'Dirty draft before update')
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)),
    ).toBe(true)
  })

  test('waits to show an update notice until another dialog closes', async ({
    page,
    request,
  }) => {
    await prepareControlledPage(page)
    await page.getByRole('button', { name: 'Filter' }).click()
    const filterDialog = page.getByRole('dialog', { name: 'Filter notes' })
    await expect(filterDialog).toBeVisible()

    await publishVersion(request, 'v2')
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update()
    })
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0)

    await filterDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Update available', { exact: true })).toBeVisible()
  })

  test('saves a dirty draft before applying the update', async ({ page, request }) => {
    await prepareControlledPage(page)
    await page.getByRole('button', { name: /new note/i }).click()
    await page.getByLabel('Title').fill('Saved before PWA update')
    await page.getByLabel('Body').fill('Persist this dirty draft')
    await publishVersion(request, 'v2')
    await checkForUpdate(page)
    await page.getByRole('button', { name: 'Restart to update' }).click()

    const reloaded = page.waitForEvent('load')
    await page
      .getByRole('dialog', { name: 'Update available' })
      .getByRole('button', { name: 'Save and restart' })
      .click()
    await reloaded

    await expect
      .poll(() =>
        page.evaluate(async () => {
          return new Promise<string | null>((resolve, reject) => {
            const openRequest = indexedDB.open('markdown-knowledge-board')
            openRequest.onerror = () => reject(openRequest.error)
            openRequest.onsuccess = () => {
              const database = openRequest.result
              const readRequest = database
                .transaction('notes', 'readonly')
                .objectStore('notes')
                .getAll()
              readRequest.onerror = () => reject(readRequest.error)
              readRequest.onsuccess = () => {
                const note = readRequest.result.find(
                  (candidate) => candidate.title === 'Saved before PWA update',
                )
                database.close()
                resolve(note?.body ?? null)
              }
            }
          })
        }),
      )
      .toBe('Persist this dirty draft')
  })

  test('keeps the draft and waiting worker when save fails', async ({
    page,
    request,
  }) => {
    await prepareControlledPage(page)
    await page.getByRole('button', { name: /new note/i }).click()
    await page.getByLabel('Body').fill('Draft survives forced save failure')
    await publishVersion(request, 'v2')
    await checkForUpdate(page)
    await page.getByRole('button', { name: 'Restart to update' }).click()
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = function put() {
        throw new DOMException('Forced save failure', 'QuotaExceededError')
      }
    })

    const dialog = page.getByRole('dialog', { name: 'Update available' })
    await dialog.getByRole('button', { name: 'Save and restart' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Forced save failure')
    await expectBodyEditorValue(
      page.getByLabel('Body'),
      'Draft survives forced save failure',
    )
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)),
    ).toBe(true)
    expect(
      await page.evaluate(
        () => document.querySelector('meta[name="pwa-test-version"]')?.getAttribute('content') ?? null,
      ),
    ).toBeNull()
  })

  test('does not force-reload a second tab with an unsaved draft', async ({
    context,
    page,
    request,
  }) => {
    await prepareControlledPage(page)
    const secondPage = await context.newPage()
    await secondPage.goto('/')
    await expect
      .poll(() =>
        secondPage.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true)
    await secondPage.getByRole('button', { name: /new note/i }).click()
    await secondPage.getByLabel('Body').fill('Second tab unsaved draft')

    await publishVersion(request, 'v2')
    await checkForUpdate(page)
    await restartAndWaitForVersionTwo(page)

    await expectBodyEditorValue(secondPage.getByLabel('Body'), 'Second tab unsaved draft')
    expect(
      await secondPage.evaluate(
        () => document.querySelector('meta[name="pwa-test-version"]')?.getAttribute('content') ?? null,
      ),
    ).toBeNull()
  })
})

test.describe('Phase 3 iPhone install help fallback', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  })

  test('provides keyboard-accessible Add to Home Screen guidance', async ({ page }) => {
    await page.addInitScript(() => {
      window.addEventListener(
        'beforeinstallprompt',
        (event) => event.stopImmediatePropagation(),
        true,
      )
    })
    await prepareControlledPage(page)
    await page.getByLabel('Open application menu').click()
    await page.getByRole('menuitem', { name: 'Install Help' }).click()

    const dialog = page.getByRole('dialog', { name: 'Install on iPhone' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await expect(dialog).toContainText('Add to Home Screen')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('Open application menu')).toBeFocused()
  })
})
