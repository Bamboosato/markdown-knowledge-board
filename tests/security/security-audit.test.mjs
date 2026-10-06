import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { evaluateAudits, parseAuditProcess } from '../../scripts/security-audit-policy.mjs'

// Functional: zero findings passes, all runtime findings block.
// Non-functional: command/transport/parse failures block with diagnosable errors.
// Data: npm metadata, graph links, lock paths and dev flags must agree.
// UI: no UI here; E2E covers the user data affected by dependency updates.
// Normal/error/boundary/state cases below cover expiry equality, runtime
// promotion and a second advisory so an exception cannot expand silently.
const url = 'https://github.com/advisories/GHSA-1111-2222-3333'
const now = new Date('2026-10-06T00:00:00.000Z')
function report(items = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }
  for (const item of Object.values(items)) { counts[item.severity]++; counts.total++ }
  return { auditReportVersion: 2, vulnerabilities: items, metadata: { vulnerabilities: counts } }
}
function finding(name = 'leaf', severity = 'high', via = [{ url, severity }]) {
  return { name, severity, via, nodes: [`node_modules/${name}`] }
}
function fixture() {
  return {
    production: report(), full: report({ leaf: finding() }), now,
    lock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/leaf': { version: '1.0.0', dev: true } } },
    exceptions: [{ advisory: url, owner: 'Maintainers', reason: 'No published fix',
      expires: '2026-10-07T00:00:00.000Z', packages: { leaf: { 'node_modules/leaf': '1.0.0' } } }],
  }
}
test('normal: an empty production and full graph succeeds without exceptions', () => {
  const f = fixture(); f.full = report(); f.exceptions = []
  assert.equal(evaluateAudits(f).ok, true)
})
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  test(`error: production ${severity} blocks even with a matching exception`, () => {
    const f = fixture(); f.full = f.production = report({ leaf: finding('leaf', severity) })
    assert.equal(evaluateAudits(f).ok, false)
  })
}
test('error: development findings block when no exception is configured', () => {
  const f = fixture(); f.exceptions = []; assert.equal(evaluateAudits(f).ok, false)
})
test('normal: only exact, unexpired development findings are excepted', () => {
  assert.deepEqual(evaluateAudits(fixture()), { ok: true, blocked: [], excepted: ['leaf'] })
})
for (const [label, date, ok] of [
  ['before', '2026-10-06T23:59:59.999Z', true],
  ['equal', '2026-10-07T00:00:00.000Z', false],
  ['after', '2026-10-07T00:00:00.001Z', false],
]) test(`boundary: ${label} expiry`, () => {
  const f = fixture(); f.now = new Date(date); assert.equal(evaluateAudits(f).ok, ok)
})
const mutations = {
  'runtime promotion': (f) => { delete f.lock.packages['node_modules/leaf'].dev },
  'version changes': (f) => { f.lock.packages['node_modules/leaf'].version = '1.0.1' },
  'path changes': (f) => {
    f.full.vulnerabilities.leaf.nodes = ['node_modules/parent/node_modules/leaf']
    f.lock.packages['node_modules/parent/node_modules/leaf'] = { version: '1.0.0', dev: true }
  },
  'another advisory': (f) => { f.full.vulnerabilities.leaf.via.push({ url: url + '-extra', severity: 'low' }) },
  'critical finding': (f) => { f.full = report({ leaf: finding('leaf', 'critical') }) },
  'critical advisory': (f) => { f.full.vulnerabilities.leaf.via[0].severity = 'critical' },
  'missing lock path': (f) => { delete f.lock.packages['node_modules/leaf'] },
  'missing owner': (f) => { delete f.exceptions[0].owner },
  'missing reason': (f) => { delete f.exceptions[0].reason },
  'invalid UTC expiry': (f) => { f.exceptions[0].expires = 'not a date' },
  'metadata disagreement': (f) => { f.full.metadata.vulnerabilities.total = 0 },
  'severity disagreement': (f) => { f.full.metadata.vulnerabilities.high = 0 },
  'missing metadata': (f) => { delete f.full.metadata },
  'array instead of graph': (f) => { f.full.vulnerabilities = [] },
  'missing advisory': (f) => { f.full.vulnerabilities.leaf.via = [] },
  'missing nodes': (f) => { f.full.vulnerabilities.leaf.nodes = [] },
  'unknown severity': (f) => { f.full.vulnerabilities.leaf.severity = 'unknown' },
  'npm error response': (f) => { f.full.error = { code: 'ENOAUDIT' } },
  'unsupported schema': (f) => { f.full.auditReportVersion = 3 },
  'missing lock packages': (f) => { delete f.lock.packages },
}
for (const [label, mutate] of Object.entries(mutations)) test(`error/state: ${label} blocks`, () => {
  const f = fixture(); mutate(f); assert.equal(evaluateAudits(f).ok, false)
})
test('normal/state: dependency-derived findings must resolve to the same allowed advisory', () => {
  const f = fixture(); f.full = report({ leaf: finding(), parent: finding('parent', 'high', ['leaf']) })
  f.lock.packages['node_modules/parent'] = { version: '2.0.0', dev: true }
  f.exceptions[0].packages.parent = { 'node_modules/parent': '2.0.0' }
  assert.equal(evaluateAudits(f).ok, true)
  f.full.vulnerabilities.leaf.via.push({ url: url + '-new', severity: 'low' })
  assert.equal(evaluateAudits(f).ok, false)
})
test('error: cyclic or missing advisory references never qualify for exceptions', () => {
  const f = fixture(); f.full.vulnerabilities.leaf.via = ['leaf']
  assert.equal(evaluateAudits(f).ok, false)
  f.full.vulnerabilities.leaf.via = ['missing']; assert.equal(evaluateAudits(f).ok, false)
})
test('normal: exit codes 0 and 1 parse clean and finding responses respectively', () => {
  assert.deepEqual(parseAuditProcess({ status: 0, stdout: JSON.stringify(report()) }), report())
  assert.deepEqual(parseAuditProcess({ status: 1, stdout: JSON.stringify(fixture().full) }), fixture().full)
})
for (const [label, result] of [
  ['network failure', { status: 1, stdout: JSON.stringify({ error: { code: 'ECONNRESET' } }) }],
  ['timeout', { status: null, error: new Error('ETIMEDOUT') }],
  ['signal', { status: 0, signal: 'SIGTERM', stdout: JSON.stringify(report()) }],
  ['invalid JSON', { status: 0, stdout: '{' }],
  ['empty output', { status: 0, stdout: '' }],
  ['unexpected exit', { status: 2, stdout: JSON.stringify(report()) }],
  ['false clean exit', { status: 0, stdout: JSON.stringify(fixture().full) }],
  ['finding exit with no findings', { status: 1, stdout: JSON.stringify(report()) }],
]) test(`execution error: ${label} cannot pass`, () => assert.throws(() => parseAuditProcess(result)))

// Exercise the command entrypoint in an isolated project, including evidence
// preservation. Never fake npm in the real checkout or contact real accounts.
for (const mode of ['clean', 'findings', 'network', 'invalid-json']) {
  test(`integration: ${mode} preserves both scopes and the final decision`, () => {
    const root = mkdtempSync(join(tmpdir(), 'mkb-audit-test-'))
    try {
      mkdirSync(join(root, 'scripts'))
      for (const file of ['security-audit.mjs', 'security-audit-policy.mjs']) {
        copyFileSync(new URL(`../../scripts/${file}`, import.meta.url), join(root, 'scripts', file))
      }
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify(fixture().lock))
      const fakeCli = join(root, 'fake-npm.cjs')
      const productionOutput = mode === 'network' ? JSON.stringify({ error: { code: 'ECONNRESET' } })
        : mode === 'invalid-json' ? '{' : mode === 'findings' ? JSON.stringify(fixture().full) : JSON.stringify(report())
      writeFileSync(fakeCli, `
        const production = process.argv.includes('--omit=dev');
        if (process.argv.includes('--version')) console.log('11.6.2');
        else {
          process.stdout.write(production ? ${JSON.stringify(productionOutput)} : ${JSON.stringify(JSON.stringify(report()))});
          process.exitCode = production && ${JSON.stringify(mode)} !== 'clean' ? 1 : 0;
        }
      `)
      const result = spawnSync(process.execPath, [join(root, 'scripts/security-audit.mjs')], {
        cwd: root, env: { ...process.env, npm_execpath: fakeCli }, encoding: 'utf8', timeout: 15_000,
      })
      assert.equal(result.status, mode === 'clean' ? 0 : 1, result.stderr)
      const evidence = join(root, '.security-audit')
      assert.equal(readFileSync(join(evidence, 'production.json'), 'utf8'), productionOutput)
      assert.deepEqual(JSON.parse(readFileSync(join(evidence, 'full.json'), 'utf8')), report())
      const execution = JSON.parse(readFileSync(join(evidence, 'execution.json'), 'utf8'))
      assert.equal(execution.audits.full.status, 0)
      assert.equal(JSON.parse(readFileSync(join(evidence, 'policy.json'), 'utf8')).ok, mode === 'clean')
    } finally {
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory')
      rmSync(root, { recursive: true, force: true })
    }
  })
}
