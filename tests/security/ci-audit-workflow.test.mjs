import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import yaml from 'js-yaml'

// Functional: audit failure must not skip build, smoke or PWA; its own failure
// must remain visible. State: a workflow edit must not silently rejoin gates.
test('audit and functional checks remain independent and fail closed', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
  const jobs = workflow.jobs
  const runs = (job) => job.steps.map(step => step.run).filter(Boolean)
  assert.equal(jobs.verify.name, 'Verify')
  assert.ok(runs(jobs.verify).includes('npm run build'))
  assert.ok(!runs(jobs.verify).includes('npm run audit:security'))
  assert.equal(jobs['dependency-audit'].name, 'Dependency audit')
  assert.equal(jobs['dependency-audit'].needs, undefined)
  const audit = jobs['dependency-audit'].steps.find(step => step.run === 'npm run audit:security')
  assert.ok(audit)
  assert.notEqual(audit['continue-on-error'], true)
  assert.notEqual(jobs['dependency-audit']['continue-on-error'], true)
  assert.ok(jobs['dependency-audit'].steps.some(step => step.name === 'Upload dependency audit evidence' && step.if === 'always()'))
  assert.equal(jobs.pwa.needs, 'verify')
  assert.equal(jobs['browser-smoke'].needs, 'verify')
})
