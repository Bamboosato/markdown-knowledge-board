// Uses isolated installation, desktop, pairing and Codex settings. Never changes the user's installation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const env = { ...process.env, CODEX_HOME: join(work, 'codex'), MKB_MCP_STATE_DIR: join(work, 'pairing'), MKB_MCP_PORT: String(testPort) };
const quote = text => `'${text.replaceAll("'", "''")}'`;
const ps = code => execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); ${code}`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 180000 });
const checks = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const bundle = JSON.parse(execFileSync(process.execPath, ['tools/local-mcp/windows/build-kit.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true }));
ps(`Expand-Archive -LiteralPath ${quote(bundle.archive)} -DestinationPath ${quote(work)}`);
const kit = join(work, 'MKB-Windows-Setup');
const manifest = JSON.parse(await readFile(join(kit, 'manifest.json'), 'utf8'));
assert.equal(manifest.files.length, 16);
assert.ok(manifest.files.every(f => !/identity\.json|setup-config|node_modules|\.codex|output/.test(f.path)));
pass('ZIP extracts with only the allowlisted source files and no PC identity or credentials');

const desktop = join(work, 'Desktop');
const codexDirectory = env.CODEX_HOME;
await mkdir(desktop);
await mkdir(codexDirectory);
const configPath = join(codexDirectory, 'config.toml');
await writeFile(configPath, '[mcp_servers.unrelated]\ncommand = "node"\nargs = ["unrelated.mjs"]\n');
const pwaShortcut = join(work, 'Markdown Knowledge Board.lnk');
// Synthetic shortcut for installation tests only. This test never launches it.
const shortcutType = `Add-Type -Path ${quote(join(kit, 'tools/local-mcp/WindowsShortcut.cs'))};`;
ps(`${shortcutType} [MkbWindowsShortcut]::Write(${quote(pwaShortcut)}, (Get-Command powershell.exe).Source, '', ${quote(work)}, 'Test fixture', '')`);
const installRoot = join(work, 'Installed');
const installer = join(kit, 'Install.ps1');
const install = `& ${quote(installer)} -InstallRoot ${quote(installRoot)} -DesktopDirectory ${quote(desktop)} -MkbShortcut ${quote(pwaShortcut)}`;
ps(install);
const appConfig = JSON.parse((await readFile(join(installRoot, 'ConnectionSetup', 'setup-config.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(appConfig.stateDirectory, env.MKB_MCP_STATE_DIR);
assert.equal(appConfig.mkbShortcut, pwaShortcut);
assert.equal((await readFile(join(installRoot, 'ConnectionSetup', 'MKBConnectionSetup.exe'))).subarray(0, 2).toString(), 'MZ');
const link = JSON.parse(ps(`${shortcutType} $link = [MkbWindowsShortcut]::Read(${quote(join(desktop, 'MKB Connection Setup.lnk'))}); @{target=$link.TargetPath; arguments=$link.Arguments} | ConvertTo-Json -Compress`));
assert.equal(link.target, join(installRoot, 'ConnectionSetup', 'MKBConnectionSetup.exe'));
assert.equal(link.arguments, '');
const registration = JSON.parse(ps('codex mcp get mkb_local_prototype --json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'));
assert.equal(registration.transport.args[0], join(installRoot, 'start-mcp.mjs'));
assert.ok((await readFile(configPath, 'utf8')).includes('[mcp_servers.unrelated]'));
pass('Fresh install compiles the GUI, creates a secret-free shortcut and registers MCP without changing other entries');

async function probe() {
  const client = new Client({ name: 'windows-kit-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(installRoot, 'start-mcp.mjs')], env, stderr: 'pipe' });
  // Drain startup messages without printing credentials or user data.
  transport.stderr.on('data', () => {});
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['connection_status', 'create_note', 'get_note', 'search_notes', 'update_note']);
    const result = await client.callTool({ name: 'connection_status', arguments: {} });
    assert.notEqual(result.isError, true);
    const status = JSON.parse(result.content[0].text);
    assert.equal(status.persistentPairing, true);
    assert.equal(status.connected, false);
  } finally { await client.close(); }
}
await probe();
const identityBefore = await readFile(join(env.MKB_MCP_STATE_DIR, 'identity.json'), 'utf8');
const code = execFileSync(process.execPath, [join(installRoot, 'ConnectionSetup', 'setup-code.mjs')], { env, encoding: 'utf8', windowsHide: true });
assert.ok(code.startsWith(`MKB1|http://127.0.0.1:${testPort}|`));
const identity = JSON.parse(identityBefore);
assert.ok(code.endsWith(identity.browserToken));
pass('Installed launcher initializes the real MCP; setup helper reads the same pairing without exposing it');

const configBefore = await readFile(configPath, 'utf8');
const launcherBefore = await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8');
ps(install);
assert.equal(await readFile(configPath, 'utf8'), configBefore);
assert.equal(await readFile(join(env.MKB_MCP_STATE_DIR, 'identity.json'), 'utf8'), identityBefore);
assert.notEqual(await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8'), launcherBefore);
await probe();
pass('Reinstallation switches runtime, preserves pairing and registration, and starts successfully');

const tamperTarget = join(kit, 'tools', 'local-mcp', 'setup-code.mjs');
const activeLauncher = await readFile(join(installRoot, 'start-mcp.mjs'), 'utf8');
const originalHelper = await readFile(tamperTarget);
await writeFile(tamperTarget, '// changed package');
assert.throws(() => ps(install), /Package file changed/);
await writeFile(tamperTarget, originalHelper);
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
await writeFile(join(work, 'result.json'), JSON.stringify({ checks, kit: bundle.archive, note: 'Synthetic PWA shortcut; no actual second-PC or browser permission test.' }, null, 2));
console.log(`Evidence: ${join(work, 'result.json')}`);
