// Standalone integration probe: real MCP STDIO + an isolated Chromium context.
// Run from the repository root: node tools/local-mcp/verify.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://127.0.0.1:5186';
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  cwd: root, stderr: 'pipe',
  env: { ...process.env, MKB_MCP_DEV: '1' },
});
let stderr = '';
transport.stderr.on('data', data => { stderr += data.toString(); });
const client = new Client({ name: 'mkb-prototype-verifier', version: '0.1.0' });
let browser;
const checks = [];
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const value = response => JSON.parse(response.content[0].text);
const sample = {
  request_id: 'poc-note-20261116', title: 'MCP試作ノート',
  markdown: '# MCP試作ノート\n\n日本語と絵文字 📝\n\n| 項目 | 結果 |\n| --- | --- |\n| 保存 | 確認 |\n\n```js\nconst saved = true;\n```',
  tags: ['試作', 'MCP'],
};
async function notes(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('markdown-knowledge-board', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('notes').objectStore('notes').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

try {
  await client.connect(transport);
  const token = value(await call('connection_status')).pairingToken;
  assert.ok(token, 'Server must return setup instructions through the MCP tool');
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['connection_status', 'create_note']);
  pass('MCP initialize and tools/list');
  assert.equal((await call('create_note', sample)).isError, true);
  assert.equal(value(await call('connection_status')).connected, false);
  pass('No browser is reported as an error, never as saved');

  const rejected = await fetch(`${origin}/__local_mcp/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ clientId: crypto.randomUUID() }),
  });
  assert.equal(rejected.status, 403);
  const wrongOrigin = await fetch(`${origin}/__local_mcp/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ clientId: crypto.randomUUID() }),
  });
  assert.equal(wrongOrigin.status, 403);
  pass('Missing token and wrong Origin rejected');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /new note/i }).click();
  await page.getByLabel('Title', { exact: true }).fill('既存ノート');
  await page.getByRole('textbox', { name: 'Body', exact: true }).fill('保存済みの本文');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText('Status: Saved', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Body', exact: true }).fill('未保存の編集中本文');

  const connect = async () => {
    await page.locator('.local-mcp-indicator').waitFor();
    if (await page.locator('.local-mcp-indicator').getAttribute('aria-expanded') === 'false') {
      await page.locator('.local-mcp-indicator').click();
    }
    await page.getByLabel('Pairing token').fill(token);
    await page.getByRole('button', { name: 'Connect local MCP', exact: true }).click();
    await page.getByRole('button', { name: 'MCP接続中：接続設定を開く', exact: true }).waitFor();
    await page.getByRole('complementary', { name: 'Local MCP', exact: true }).waitFor({ state: 'hidden' });
  };
  await connect();
  await page.locator('.local-mcp-indicator').click();
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('complementary', { name: 'Local MCP', exact: true }).isVisible(), false);
  assert.equal(value(await call('connection_status')).connected, true);
  assert.equal(await page.locator('.local-mcp-indicator').evaluate(el => el === document.activeElement), true);
  pass('Connect auto-hides panel; reopening and Escape keep receiving and restore indicator focus');
  const second = await context.newPage();
  await second.goto(origin, { waitUntil: 'domcontentloaded' });
  await second.getByLabel('Pairing token').fill(token);
  await second.getByRole('button', { name: 'Connect local MCP', exact: true }).click();
  await second.getByText('Another tab is connected. Disconnect it first.', { exact: true }).waitFor();
  await second.close();
  pass('Explicit pairing; second tab cannot take over');

  const created = await call('create_note', sample);
  assert.equal(created.isError, false);
  const receipt = value(created);
  assert.equal(receipt.status, 'saved');
  assert.equal(receipt.reused, false);
  await page.locator('.note-title', { hasText: sample.title }).waitFor();
  let stored = await notes(page);
  assert.equal(stored.length, 2);
  assert.equal(stored.find(n => n.id === receipt.id).body, sample.markdown);
  assert.deepEqual(stored.find(n => n.id === receipt.id).tags, sample.tags);
  assert.equal(stored.find(n => n.title === '既存ノート').body, '保存済みの本文');
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), '既存ノート');
  assert.equal(await page.getByRole('textbox', { name: 'Body', exact: true }).evaluate(el => el.value), '未保存の編集中本文');
  pass('Real MCP create -> browser save receipt; Unicode, tags, existing data and unsaved editor preserved');
  await mkdir(new URL('../../output/playwright/local-mcp/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../../output/playwright/local-mcp/saved.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const indicator = await page.locator('.local-mcp-indicator').boundingBox();
  assert.ok(indicator && indicator.x >= 0 && indicator.x + indicator.width <= 390);
  await page.screenshot({ path: fileURLToPath(new URL('../../output/playwright/local-mcp/indicator-mobile.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass('Header indicator remains visible at desktop and narrow widths');
  const retry = value(await call('create_note', sample));
  assert.equal(retry.id, receipt.id);
  assert.equal(retry.reused, true);
  assert.equal((await notes(page)).length, 2);
  assert.equal((await call('create_note', { ...sample, markdown: 'Different content' })).isError, true);
  assert.equal((await notes(page)).find(n => n.id === receipt.id).body, sample.markdown);
  pass('Retry reuses the note; different content with same ID cannot overwrite');

  assert.equal((await call('create_note', { ...sample, request_id: 'invalid-input', markdown: ' ' })).isError, true);
  assert.equal((await call('create_note', { ...sample, request_id: 'invalid-input', markdown: 'あ'.repeat(43691) })).isError, true);
  pass('Empty input and UTF-8 byte size limit rejected through MCP');

  // Fail the actual IndexedDB add, not the MCP handler; no success receipt may escape.
  await page.evaluate(() => {
    window.originalMcpAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (args[0]?.id?.startsWith('mcp-')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return window.originalMcpAdd.apply(this, args);
    };
  });
  assert.equal((await call('create_note', { ...sample, request_id: 'quota-failure' })).isError, true);
  assert.equal((await notes(page)).length, 2);
  await page.evaluate(() => { IDBObjectStore.prototype.add = window.originalMcpAdd; delete window.originalMcpAdd; });
  pass('IndexedDB failure returns an error without creating a note');

  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText('Status: Saved', { exact: true }).waitFor();
  await page.locator('.local-mcp-indicator').click();
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).click();
  await page.getByRole('button', { name: 'MCP未接続：接続設定を開く', exact: true }).waitFor();
  // Wait for explicit disconnect before reconnecting after a reload.
  for (let attempt = 0; value(await call('connection_status')).connected; attempt++) {
    assert.ok(attempt < 50);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.reload();
  await page.locator('.note-title', { hasText: sample.title }).waitFor();
  await connect();
  assert.equal(value(await call('create_note', sample)).reused, true);
  stored = await notes(page);
  assert.equal(stored.length, 2);
  assert.equal(stored.find(n => n.id === receipt.id).body, sample.markdown);
  pass('Reload preserves the note and retry deduplication');

  await page.route('**/__local_mcp/ack', route => route.abort());
  const uncertainInput = { ...sample, request_id: 'lost-receipt-001', title: '応答喪失テスト' };
  const uncertain = await call('create_note', uncertainInput);
  assert.equal(uncertain.isError, true);
  await page.getByRole('button', { name: 'MCP接続エラー：接続設定を開く', exact: true }).waitFor();
  assert.equal((await notes(page)).length, 3);
  await page.unroute('**/__local_mcp/ack');
  await connect();
  const recovered = value(await call('create_note', uncertainInput));
  assert.equal(recovered.reused, true);
  assert.equal((await notes(page)).length, 3);
  pass('Lost save receipt is not reported as success; retry does not duplicate');

  assert.deepEqual(pageErrors, []);
  pass('No browser runtime errors');
  await writeFile(new URL('../../output/playwright/local-mcp/result.json', import.meta.url), JSON.stringify({
    checkedAt: new Date().toISOString(), browser: browser.version(), checks,
  }, null, 2));
} catch (error) {
  console.error('Server diagnostics:', stderr.replace(/Pairing token: [a-f0-9]+/g, 'Pairing token: [redacted]').slice(-3000));
  console.error(String(error.stack ?? error).replace(/[a-f0-9]{64}/g, '[redacted]'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await client.close();
}
