import { mkdirSync, writeFileSync } from 'node:fs'
import { platform, release, arch } from 'node:os'
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter'

// Selected tests are a contract: zero/partial selection or skipped/flaky cases
// must not silently produce a green required check.
export default class CiReporter implements Reporter {
  private suite?: Suite
  private config?: FullConfig
  private options: { scope: string; expected: number }
  constructor(options: { scope: string; expected: number }) { this.options = options }
  onBegin(config: FullConfig, suite: Suite) { this.config = config; this.suite = suite }
  async onEnd(result: FullResult) {
    const tests = this.suite?.allTests() ?? []
    const listing = process.argv.includes('--list')
    const completed = tests.every((test) => test.outcome() === 'expected' &&
      test.expectedStatus === 'passed' && test.results.at(-1)?.status === 'passed')
    const ok = result.status === 'passed' && tests.length === this.options.expected && (listing || completed)
    mkdirSync('test-results', { recursive: true })
    const summary = {
      scope: this.options.scope, expected: this.options.expected, selected: tests.length, ok,
      mode: listing ? 'list (not executed)' : 'execution',
      environment: { os: platform(), release: release(), arch: arch(), node: process.version },
      workers: this.config?.workers,
      untested: 'Other E2E, Firefox/WebKit, real cloud accounts and native device/print dialogs',
      tests: tests.map((test) => ({
        title: test.titlePath().join(' > '), outcome: test.outcome(),
        status: test.results.at(-1)?.status,
        annotations: test.annotations,
      })),
    }
    writeFileSync(`test-results/${this.options.scope}-summary.json`, JSON.stringify(summary, null, 2) + '\n')
    if (!ok) console.error(`CI ${this.options.scope}: expected ${this.options.expected} passed tests, selected ${tests.length}`)
    return { status: ok ? 'passed' as const : 'failed' as const }
  }
}
