import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FullConfig, FullResult, Suite } from '@playwright/test/reporter'
import CiReporter from '../fixtures/ci-reporter'

vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

// CI signal viewpoints: normal complete success, zero/partial selection,
// skipped or flaky results, and runner failure. No browser or filesystem state.
describe('required E2E result policy', () => {
  const decide = async (count: number, outcome = 'expected', status = 'passed', run = 'passed') => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new CiReporter({ scope: 'test', expected: 14 })
    reporter.onBegin({ workers: 1 } as FullConfig, {
      allTests: () => Array.from({ length: count }, () => ({
        outcome: () => outcome, expectedStatus: 'passed', results: [{ status }],
        titlePath: () => ['fixture'], annotations: [],
      })),
    } as unknown as Suite)
    return (await reporter.onEnd({ status: run } as FullResult)).status
  }
  it('accepts all 14 successful tests', async () => expect(await decide(14)).toBe('passed'))
  it('rejects empty, partial and unexpectedly expanded selections', async () => {
    for (const count of [0, 13, 15]) expect(await decide(count)).toBe('failed')
  })
  it('rejects skipped and flaky cases despite an overall green run', async () => {
    expect(await decide(14, 'skipped', 'skipped')).toBe('failed')
    expect(await decide(14, 'flaky')).toBe('failed')
  })
  it('rejects runner interruption even when test results look complete', async () => {
    expect(await decide(14, 'expected', 'passed', 'interrupted')).toBe('failed')
  })
})
