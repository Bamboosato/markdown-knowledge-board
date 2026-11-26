import {readFile, stat, writeFile} from 'node:fs/promises';
import {basename,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run = promisify(execFile);

// These are operation contracts, independent of both the package and note protocol versions.
export const profileOperations = ['destination.options', 'destination.verify', 'destination.commit'];
export const pairingOperations = profiles => ['manual.connect', ...(profiles ? profileOperations : [])];
export const supportsPairing = (offered, required) =>
  Array.isArray(offered) && required.every(operation => offered.includes(operation));

// Legacy brokers stop themselves after 30 seconds without MCP activity, on a 5-second timer.
// A timestamp shared by all updated clients lets their heartbeats yield for one idle period.
// No PID is killed, identity is never edited, and actual note operations remain available.
const quietMs = 38_000;
export function pairingHandoff(directory) {
  const marker = join(directory, 'pairing-handoff');
  async function age() {
    try { return Date.now() - (await stat(marker)).mtimeMs; }
    catch (error) { if (error.code === 'ENOENT') return Infinity; throw error; }
  }
  return {
    async waiting() { const elapsed = await age(); return elapsed >= 0 && elapsed < quietMs; },
    async begin() {
      const elapsed = await age();
      if (elapsed >= 0 && elapsed < quietMs) return 'waiting';
      // An older client may still be renewing the old broker. Don't start an endless retry loop.
      if (elapsed >= quietMs && elapsed < quietMs + 60_000) return 'restart';
      await writeFile(marker, 'waiting\n', {mode:0o600});
      return 'waiting';
    },
  };
}

export async function configuredBroker(launcher = process.argv[1]) {
  if (basename(launcher ?? '').toLowerCase() !== 'start-mcp.mjs') return new URL('./broker.mjs',import.meta.url);
  // Setup atomically replaces this fixed launcher when it installs a new versioned directory.
  const source = await readFile(launcher,'utf8');
  const entry = /^await import\(("(?:[^"\\]|\\.)*")\);\s*$/m.exec(source);
  if (!entry) throw Error('Cannot read the configured MKB launcher. Restart the MCP client to reload its settings.');
  const server = new URL(JSON.parse(entry[1]));
  const path = relative(join(dirname(launcher),'runtimes'),fileURLToPath(server));
  if (isAbsolute(path) || path.startsWith('..'+sep) || !path.endsWith(join('tools','local-mcp','server.mjs'))) throw Error('Unexpected installed MKB runtime path.');
  return new URL('./broker.mjs',server);
}

export async function installedPairingOperations(candidate) {
  // Load the actual candidate, with its dependencies, in a fresh process. Importing the
  // broker module does not bind a port, read user settings or start a browser.
  const {stdout} = await run(process.execPath,['--input-type=module','-e',
    'const broker=await import(process.argv[1]); console.log(JSON.stringify(broker.availablePairingOperations ?? []))',
    candidate.href],{windowsHide:true,timeout:5000});
  return JSON.parse(stdout);
}
