import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluateAudits, parseAuditProcess } from './security-audit-policy.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = new URL('../.security-audit/', import.meta.url)
mkdirSync(evidence, { recursive: true })
const save = (name, data) => writeFileSync(new URL(name, evidence), JSON.stringify(data, null, 2) + '\n')
const execution = { generatedAt: new Date().toISOString(), node: process.version, npm: null, audits: {} }
// A failure before npm starts must not upload a previous run's clean reports.
for (const scope of ['production', 'full']) save(`${scope}.json`, { error: 'Audit not completed' })
let decision = { ok: false, blocked: ['Audit did not complete'], excepted: [] }
try {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('Run with npm run audit:security')
  const invoke = (args) => spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120_000,
  })
  const version = invoke(['--version'])
  if (version.error || version.status !== 0 || !/^11\./.test(version.stdout.trim())) {
    throw new Error('Security audit requires npm 11')
  }
  execution.npm = version.stdout.trim()
  const reports = {}, failures = []
  for (const [name, args] of [['production', ['--omit=dev']], ['full', ['--include=dev']]]) {
    const result = invoke(['audit', '--json', '--audit-level=low', ...args])
    // Keep the original response even if JSON parsing fails. Run both scopes so
    // a network error in one does not hide the other scope's evidence.
    writeFileSync(new URL(`${name}.json`, evidence), result.stdout || '{}\n')
    execution.audits[name] = {
      status: result.status, signal: result.signal,
      error: result.error?.message ?? null, stderr: result.stderr,
    }
    try { reports[name] = parseAuditProcess(result) }
    catch (error) { failures.push(`${name}: ${error.message}`) }
  }
  if (failures.length) throw new Error(failures.join('; '))
  const exceptionPath = new URL('../security-audit-exceptions.json', import.meta.url)
  const exceptions = existsSync(exceptionPath) ? JSON.parse(readFileSync(exceptionPath, 'utf8')) : []
  decision = evaluateAudits({ ...reports, exceptions,
    lock: JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) })
  for (const [name, report] of Object.entries(reports)) {
    console.log(`${name} vulnerabilities:`, report.metadata.vulnerabilities)
  }
  if (decision.excepted.length) console.log('Temporary dev exceptions:', decision.excepted)
} catch (error) {
  decision = { ok: false, blocked: [error.message], excepted: [] }
} finally {
  save('execution.json', execution)
  save('policy.json', decision)
}
if (!decision.ok) {
  console.error('Security audit blocked:', decision.blocked.join('; '))
  process.exitCode = 1
} else console.log('Security audit passed (production and full dependency graph)')
