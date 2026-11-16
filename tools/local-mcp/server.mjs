// Record startup failures without note content, environment values, or pairing tokens.
import { mkdir, writeFile } from 'node:fs/promises';
const diagnosticDir = new URL('../../output/local-mcp/', import.meta.url);
const diagnosticFile = new URL(`startup-${process.pid}.json`, diagnosticDir);
async function record(phase, error) {
  await mkdir(diagnosticDir, { recursive: true });
  await writeFile(diagnosticFile, JSON.stringify({
    time: new Date().toISOString(), pid: process.pid, phase,
    error: error ? { name: error.name, code: error.code, message: error.message } : undefined,
  }, null, 2));
}
try {
  await record('starting').catch(() => {});
  await import('./runtime.mjs');
  await record('ready').catch(() => {});
} catch (error) {
  await record('failed', error).catch(() => {});
  process.stderr.write(`Local MCP startup failed: ${error.message}\n`);
  process.exit(1);
}
