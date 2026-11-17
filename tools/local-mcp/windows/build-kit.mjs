import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('Build the Windows setup kit on Windows.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = join(root, 'output', 'windows-setup', `build-${Date.now()}`);
const kit = join(output, 'MKB-Windows-Setup');
const runtimeFiles = [
  'ConnectionSetup.cs', 'WindowsShortcut.cs', 'install-connection-setup.ps1', 'setup-code.mjs',
  'server.mjs', 'runtime.mjs', 'broker.mjs', 'broker-client.mjs', 'bridge.mjs',
  'identity.mjs', 'note-schema.mjs', 'metadata-schema.mjs', 'package.json', 'package-lock.json',
];
const files = [
  ...runtimeFiles.map(name => ({ source: `tools/local-mcp/${name}`, path: `tools/local-mcp/${name}` })),
  ...['Install.ps1', 'Setup.cmd', 'README.md'].map(name => ({ source: `tools/local-mcp/windows/${name}`, path: name })),
];
await mkdir(join(kit, 'tools', 'local-mcp'), { recursive: true });
const manifest = { format: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: [] };
for (const file of files) {
  await copyFile(join(root, file.source), join(kit, file.path));
  const bytes = await readFile(join(kit, file.path));
  manifest.files.push({ path: file.path, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(kit, 'manifest.json'), JSON.stringify(manifest, null, 2));
const archive = join(output, 'MKB-Windows-Setup.zip');
const quote = text => `'${text.replaceAll("'", "''")}'`;
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath ${quote(kit)} -DestinationPath ${quote(archive)}`], { windowsHide: true });
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  MKB-Windows-Setup.zip\n`);
console.log(JSON.stringify({ archive, sha256, fileCount: files.length + 1 }));
