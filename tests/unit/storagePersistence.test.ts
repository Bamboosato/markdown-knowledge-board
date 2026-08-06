import { describe, expect, it, vi } from 'vitest'

import { createStoragePersistenceRequester } from '../../src/lib/storagePersistence'

// Test viewpoints:
// - Functional: an explicit request persists storage when the browser grants it.
// - Non-functional/reliability: denial and exceptions never reject a note save.
// - Data: an already-persisted origin is not requested again.
// - Boundary/state: the same session performs at most one persistence workflow.
describe('storage persistence', () => {
  it('returns persisted without making a duplicate request', async () => {
    const persist = vi.fn(async () => true)
    const request = createStoragePersistenceRequester()

    await expect(
      request({ persisted: async () => true, persist }),
    ).resolves.toBe('persisted')
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports granted and denied requests without throwing', async () => {
    const granted = createStoragePersistenceRequester()
    const denied = createStoragePersistenceRequester()

    await expect(
      granted({ persisted: async () => false, persist: async () => true }),
    ).resolves.toBe('persisted')
    await expect(
      denied({ persisted: async () => false, persist: async () => false }),
    ).resolves.toBe('denied')
  })

  it('normalizes unsupported APIs and failures', async () => {
    await expect(createStoragePersistenceRequester()(undefined)).resolves.toBe(
      'unsupported',
    )
    await expect(
      createStoragePersistenceRequester()({
        persisted: async () => {
          throw new Error('quota subsystem unavailable')
        },
        persist: async () => true,
      }),
    ).resolves.toBe('failed')
  })

  it('shares one in-flight request within a session', async () => {
    const persisted = vi.fn(async () => false)
    const persist = vi.fn(async () => true)
    const request = createStoragePersistenceRequester()

    const [first, second] = await Promise.all([
      request({ persisted, persist }),
      request({ persisted, persist }),
    ])

    expect([first, second]).toEqual(['persisted', 'persisted'])
    expect(persisted).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
