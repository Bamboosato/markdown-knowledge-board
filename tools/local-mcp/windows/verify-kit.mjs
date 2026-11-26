// Uses isolated installation, desktop, pairing and Codex settings. Never changes the user's installation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (process.platform !== 'win32') throw new Error('Windows verification requires Windows.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const work = join(root, 'output', 'windows-setup', `test-${Date.now()}`, 'PC セットアップ');
await mkdir(work, { recursive: true });
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const testPort = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const env = { ...process.env, LOCALAPPDATA: join(work, 'LocalAppData'), CODEX_HOME: join(work, 'codex'), MKB_MCP_STATE_DIR: join(work, 'pairing'), MKB_MCP_PORT: String(testPort) };
const quote = text => `'${text.replaceAll("'", "''")}'`;
const ps = code => execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); ${code}`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 180000 });
const checks = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const bundle = JSON.parse(execFileSync(process.execPath, ['tools/local-mcp/windows/build-kit.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true }));
ps(`Expand-Archive -LiteralPath ${quote(bundle.archive)} -DestinationPath ${quote(work)}`);
const kit = join(work, 'MKB-Windows-Setup');
const manifest = JSON.parse(await readFile(join(kit, 'manifest.json'), 'utf8'));
assert.equal(manifest.files.length, 14);
assert.ok(manifest.files.every(f => !/ConnectionSetup|WindowsShortcut|install-connection-setup|setup-code|\.lnk$/i.test(f.path)));
assert.ok(manifest.files.some(f=>f.path==='tools/local-mcp/auto-open.mjs'));
assert.ok(manifest.files.some(f => f.path === 'tools/local-mcp/metadata-schema.mjs'));
assert.ok(manifest.files.every(f => !/identity\.json|setup-config|node_modules|\.codex|output/.test(f.path)));
pass('ZIP extracts with only the allowlisted source files and no PC identity or credentials');

const codexDirectory = env.CODEX_HOME;
await mkdir(codexDirectory);
const configPath = join(codexDirectory, 'config.toml');
await writeFile(configPath, '[mcp_servers.unrelated]\ncommand = "node"\nargs = ["unrelated.mjs"]\n');
const installRoot = join(env.LOCALAPPDATA, 'MarkdownKnowledgeBoard');
const installer = join(kit, 'Install.ps1');
const install = `& ${quote(installer)} -InstallRoot ${quote(installRoot)}`;
execFileSync('cmd.exe', ['/d', '/c', 'Setup.cmd'], { cwd: kit, env, input: '\r\n', windowsHide: true, timeout: 180000 });
await assert.rejects(access(join(installRoot,'ConnectionSetup')), {code:'ENOENT'});
const registration = JSON.parse(ps('codex mcp get mkb_local_prototype --json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'));
assert.equal(registration.transport.args[0], join(installRoot, 'start-mcp.mjs'));
assert.ok((await readFile(configPath, 'utf8')).includes('[mcp_servers.unrelated]'));
pass('Setup.cmd installs only the runtime and registers MCP alongside existing entries');

async function probe() {
  const client = new Client({ name: 'windows-kit-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: registration.transport.command, args: registration.transport.args, env, stderr: 'pipe' });
  // Drain startup messages without printing credentials or user data.
  transport.stderr.on('data', () => {});
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['append_note', 'apply_custom_metadata_changes', 'connection_status', 'create_note', 'ensure_connection', 'get_note', 'preview_custom_metadata_changes', 'replace_note_text', 'search_notes', 'update_note']);
    const result = await client.callTool({ name: 'connection_status', arguments: {} });
    assert.notEqual(result.isError, true);
    const status = JSON.parse(result.content[0].text);
    assert.equal(status.persistentPairing, true);
    assert.equal(status.connected, false);
    const identity = JSON.parse(await readFile(join(env.MKB_MCP_STATE_DIR, 'identity.json'), 'utf8'));
    assert.ok(status.pairingCode === `MKB1|http://127.0.0.1:${testPort}|${identity.browserToken}`, 'Pairing code must match this installation');
  } finally { await client.close(); }
}
await probe();
const identityBefore = await readFile(join(env.MKB_MCP_STATE_DIR, 'identity.json'), 'utf8');
pass('The Codex-registered MCP returns the pairing code without a desktop helper');
const legacyDir = join(installRoot,'ConnectionSetup');
await mkdir(legacyDir);
const legacyConfig = join(legacyDir,'setup-config.json');
await writeFile(legacyConfig, '{"legacy":true}');
const configBefore = await readFile(configPath, 'utf8');
const launcherBefore = await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8');
ps(install);
assert.equal(await readFile(legacyConfig,'utf8'), '{"legacy":true}');
assert.deepEqual(await readdir(legacyDir), ['setup-config.json']);
assert.equal(await readFile(configPath, 'utf8'), configBefore);
assert.equal(await readFile(join(env.MKB_MCP_STATE_DIR, 'identity.json'), 'utf8'), identityBefore);
assert.notEqual(await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8'), launcherBefore);
await probe();
pass('Reinstallation switches runtime, preserves pairing and registration, and starts successfully');

const tamperTarget = join(kit, 'tools', 'local-mcp', 'runtime.mjs');
const activeLauncher = await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8');
const originalRuntime = await readFile(tamperTarget);
await writeFile(tamperTarget, '// changed package');
assert.throws(() => ps(install), /Package file changed/);
await writeFile(tamperTarget, originalRuntime);
assert.equal(await readFile(configPath, 'utf8'), configBefore);
assert.equal(await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8'), activeLauncher);
pass('Changed package files stop installation before replacing the active launcher or registration');

await writeFile(configPath, '[mcp_servers.mkb_local_prototype]\ncommand = "node"\nargs = ["different-server.mjs"]\n');
const conflictConfig = await readFile(configPath, 'utf8');
assert.throws(() => ps(install), /already points to another installation/);
assert.equal(await readFile(configPath, 'utf8'), conflictConfig);
ps(`${install} -SkipMcpRegistration`);
assert.equal(await readFile(configPath, 'utf8'), conflictConfig);
assert.ok((await readFile(join(installRoot, 'codex-mcp.toml'), 'utf8')).includes('[mcp_servers.mkb_local_prototype]'));
assert.equal(await readFile(join(env.MKB_MCP_STATE_DIR, 'identity.json'), 'utf8'), identityBefore);
pass('Conflicting MCP registration is preserved; explicit manual-registration installation remains available');
await writeFile(join(work, 'result.json'), JSON.stringify({ checks, kit: bundle.archive, note: 'Isolated Windows installation and real MCP pairing-code retrieval.' }, null, 2));
console.log(`Evidence: ${join(work, 'result.json')}`);
