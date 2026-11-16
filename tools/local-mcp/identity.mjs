import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';

export const stateDirectory = () => process.env.MKB_MCP_STATE_DIR || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'MarkdownKnowledgeBoard', 'mcp')
  : join(homedir(), '.local', 'state', 'markdown-knowledge-board', 'mcp'));
const credential = () => randomBytes(32).toString('hex');
function validate(value) {
  if (value?.version !== 1 || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(value.browserToken) || !/^[a-f0-9]{64}$/.test(value.serverToken) ||
      value.browserToken === value.serverToken) throw new Error('Invalid local MCP identity. Restore its backup; do not overwrite it.');
  return value;
}

// Install a fully written file atomically. Concurrent MCP starts share the winner's identity.
// Never silently replace credentials, including when a file is corrupt or a port is occupied.
function decode(raw) {
  try { return validate(JSON.parse(raw)); }
  catch { throw new Error('Invalid local MCP identity. Restore its backup; do not overwrite it.'); }
}
export async function loadIdentity({ directory = stateDirectory(), seed } = {}) {
  const path = join(directory, 'identity.json');
  try { return decode(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const value = validate({ version: 1, port: seed?.port ?? Number(process.env.MKB_MCP_PORT ?? 47831),
    browserToken: seed?.browserToken ?? credential(), serverToken: credential() });
  const temporary = join(directory, `identity-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  try {
    try { await link(temporary, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await unlink(temporary); }
  return decode(await readFile(path, 'utf8'));
}
