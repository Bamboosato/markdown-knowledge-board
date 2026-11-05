const severities = ['info', 'low', 'moderate', 'high', 'critical']
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' && value.trim().length > 0

// npm exit 1 means findings, whereas timeouts, command failures and malformed
// responses must never be interpreted as a clean dependency graph.
export function parseAuditProcess(result) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit did not complete: ${result.error?.message ?? result.signal ?? result.status}`)
  }
  const report = JSON.parse(result.stdout)
  if (!validAudit(report)) throw new Error('Invalid npm audit response')
  if ((result.status === 0) !== (report.metadata.vulnerabilities.total === 0)) {
    throw new Error('npm audit exit code disagrees with its findings')
  }
  return report
}

export function validAudit(report) {
  if (!record(report) || report.error || report.auditReportVersion !== 2 ||
      !record(report.vulnerabilities) || !record(report.metadata?.vulnerabilities)) return false
  const counts = Object.fromEntries(severities.map((severity) => [severity, 0]))
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    if (!record(item) || item.name !== name || !severities.includes(item.severity) ||
        !Array.isArray(item.via) || !item.via.length ||
        !Array.isArray(item.nodes) || !item.nodes.length ||
        !item.nodes.every(text) || new Set(item.nodes).size !== item.nodes.length) return false
    for (const cause of item.via) {
      if (typeof cause === 'string') {
        if (!Object.hasOwn(report.vulnerabilities, cause)) return false
      } else if (!record(cause) || !severities.includes(cause.severity) ||
                 !text(cause.url) || !cause.url.startsWith('https://github.com/advisories/')) return false
    }
    counts[item.severity]++
  }
  const totals = report.metadata.vulnerabilities
  return severities.every((severity) => Number.isSafeInteger(totals[severity]) && totals[severity] === counts[severity]) &&
    totals.total === Object.keys(report.vulnerabilities).length
}

export function evaluateAudits({ production, full, lock, exceptions = [], now = new Date() }) {
  const blocked = [], excepted = []
  const invalid = (message) => ({ ok: false, blocked: [message], excepted })
  if (!validAudit(production) || !validAudit(full)) return invalid('Invalid or unavailable npm audit response')
  if (lock?.lockfileVersion !== 3 || !record(lock.packages) || !record(lock.packages[''])) {
    return invalid('Invalid package-lock.json')
  }
  if (!Array.isArray(exceptions) || !Number.isFinite(now.getTime())) return invalid('Invalid exception policy')
  for (const exception of exceptions) {
    if (!record(exception) || !text(exception.advisory) ||
        !exception.advisory.startsWith('https://github.com/advisories/') ||
        !text(exception.owner) || !text(exception.reason) ||
        (Object.hasOwn(exception, 'severity') && !severities.includes(exception.severity)) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(exception.expires) ||
        !Number.isFinite(Date.parse(exception.expires)) || !record(exception.packages) ||
        !Object.keys(exception.packages).length) return invalid('Invalid exception definition')
    for (const [name, paths] of Object.entries(exception.packages)) {
      if (!record(paths) || !Object.keys(paths).length ||
          !Object.entries(paths).every(([path, version]) =>
            path.endsWith(`node_modules/${name}`) && text(version))) return invalid('Invalid exception package paths')
    }
  }
  // Validate paths even when exceptions are absent: a stale or truncated lock
  // must block rather than accidentally changing dependency classification.
  for (const report of [production, full]) {
    for (const [name, item] of Object.entries(report.vulnerabilities)) {
      if (!item.nodes.every((path) => text(lock.packages[path]?.version))) {
        return invalid(`Audit path missing from lockfile: ${name}`)
      }
    }
  }
  for (const name of Object.keys(production.vulnerabilities)) blocked.push(`production: ${name}`)
  // Each advisory must be covered independently along every dependency path.
  // A propagated package can contain causes with different severities.
  function allowed(name, candidates, seen = new Set()) {
    const item = full.vulnerabilities[name]
    if (!item || seen.has(name) || item.severity === 'critical' || Object.hasOwn(production.vulnerabilities, name)) return false
    const applicable = candidates.filter((exception) => {
      if (now.getTime() >= Date.parse(exception.expires) || !Object.hasOwn(exception.packages, name)) return false
      const paths = exception.packages[name]
      return item.nodes.every((path) => Object.hasOwn(paths, path) &&
        lock.packages[path].dev === true && lock.packages[path].version === paths[path])
    })
    if (!applicable.length) return false
    const visited = new Set(seen).add(name)
    const causeSeverity = item.via.map((cause) => typeof cause === 'string'
      ? full.vulnerabilities[cause]?.severity : cause.severity)
    // Reject inconsistent package severities. Unknown graph links also fail
    // closed rather than hiding an escalated or misreported cause.
    if (causeSeverity.some((severity) => !severities.includes(severity)) ||
        severities.indexOf(item.severity) !== Math.max(...causeSeverity.map((severity) => severities.indexOf(severity)))) return false
    return item.via.every((cause) => typeof cause === 'string'
      ? allowed(cause, applicable, visited)
      : cause.severity !== 'critical' && applicable.some((exception) =>
        cause.url === exception.advisory &&
        (exception.severity === undefined || cause.severity === exception.severity)))
  }
  for (const name of Object.keys(full.vulnerabilities)) {
    if (allowed(name, exceptions)) excepted.push(name)
    else blocked.push(`full: ${name}`)
  }
  return { ok: blocked.length === 0, blocked, excepted }
}
