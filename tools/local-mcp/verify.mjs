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
      const request = indexedDB.open('markdown-knowledge-board');
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
  const setup = value(await call('connection_status'));
  const token = setup.pairingToken;
  const pairingCode = setup.pairingCode;
  assert.equal(pairingCode, `MKB1|${origin}|${token}`);
  assert.ok(token, 'Server must return setup instructions through the MCP tool');
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['append_note', 'apply_custom_metadata_changes', 'connection_status', 'create_note', 'ensure_connection', 'get_note', 'preview_custom_metadata_changes', 'replace_note_text', 'search_notes', 'update_note']);
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

  const settings = page.getByRole('complementary', {name:'Local MCP', exact:true});
  const menu = page.getByRole('button', {name:'Open application menu'});
  async function openSettings() {
    if (!await settings.isVisible()) {
      await menu.click();
      await page.getByRole('menuitem', {name:'Local MCP', exact:true}).click();
    }
    await settings.waitFor();
  }
  async function expand(label, target = page) {
    const summary = target.locator('summary').filter({hasText:label});
    if (!await summary.locator('..').evaluate(el => el.open)) await summary.click();
  }
  async function openManual() {
    await openSettings();
    await expand('Manual connection');
  }
  const connect = async () => {
    await openManual();
    if (await page.getByRole('button', { name: 'Reconnect', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    } else {
      await page.getByLabel('Connection code', { exact: true }).fill(pairingCode);
      await page.getByRole('button', { name: 'Connect local MCP', exact: true }).click();
    }
    await page.getByRole('complementary', { name: 'Local MCP', exact: true }).waitFor({ state: 'hidden' });
  };
  await connect();
  assert.equal(await page.evaluate(() => localStorage.getItem('mkb-local-mcp-connection-v1')), null);
  await openManual();
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('complementary', { name: 'Local MCP', exact: true }).isVisible(), false);
  assert.equal(value(await call('connection_status')).connected, true);
  await menu.evaluate(el => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await menu.evaluate(el => el === document.activeElement), true);
  pass('Connect auto-hides panel; reopening and Escape keep receiving and restore app menu focus');
  const second = await context.newPage();
  await second.goto(origin, { waitUntil: 'domcontentloaded' });
  await second.getByRole('button', { name: 'Advanced settings', exact:true }).click();
  await second.getByLabel('Enter address and token').check();
  await expand('Manual connection', second);
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
  assert.equal(await page.getByRole('textbox', { name: 'Body', exact: true }).evaluate(el => el.value ?? el.textContent), '未保存の編集中本文');
  pass('Real MCP create -> browser save receipt; Unicode, tags, existing data and unsaved editor preserved');
  await mkdir(new URL('../../output/playwright/local-mcp/', import.meta.url), { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('.local-mcp-indicator').count(), 0);
    assert.equal(await page.getByRole('heading',{name:'Automatic connection for saves'}).isVisible(),false);
    assert.equal(await page.getByLabel('Editor status', {exact:true}).isVisible(),true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass('The editor shows no MCP status at desktop and mobile widths');
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
  await openManual();
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).click();
  await settings.getByText('Disconnected', {exact:true}).waitFor();
  // Wait for explicit disconnect before reconnecting after a reload.
  for (let attempt = 0; value(await call('connection_status')).connected; attempt++) {
    assert.ok(attempt < 50);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.getByLabel('Remember in this browser', { exact: true }).check();
  await page.getByLabel('Connection code', { exact: true }).fill(`MKB1|${origin}|${'0'.repeat(64)}`);
  await page.getByRole('button', { name: 'Connect local MCP', exact: true }).click();
  await openManual();
  await settings.getByText('Connection error', {exact:true}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('mkb-local-mcp-connection-v1')), null);
  await connect();
  assert.equal(await page.evaluate(() => Boolean(localStorage.getItem('mkb-local-mcp-connection-v1'))), true);
  await openManual();
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).click();
  for (let attempt = 0; value(await call('connection_status')).connected; attempt++) {
    assert.ok(attempt < 50);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  pass('One-paste pairing works; credentials are remembered only after opt-in and successful connection');
  await page.reload();
  await openManual();
  await page.locator('.note-title', { hasText: sample.title }).waitFor();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).waitFor();
  assert.equal(value(await call('connection_status')).connected, false);
  const advanced = page.getByRole('button', { name: 'Advanced settings', exact: true });
  assert.equal(await advanced.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByRole('button', { name: 'Forget connection', exact: true }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Use a new code', exact: true }).isVisible(), false);
  await page.screenshot({ path: fileURLToPath(new URL('../../output/playwright/local-mcp/reconnect.png', import.meta.url)), fullPage: true });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Use a new code', exact: true }).click();
  assert.equal(await page.getByLabel('Connection code', { exact: true }).evaluate(el => el === document.activeElement), true);
  await page.setViewportSize({ width: 320, height: 640 });
  const panel = page.getByRole('complementary', { name: 'Local MCP', exact: true });
  const panelBounds = await panel.boundingBox();
  assert.ok(panelBounds && panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= 320);
  assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('../../output/playwright/local-mcp/advanced-mobile.png', import.meta.url)), fullPage: true });
  await page.getByRole('button', { name: 'Cancel setup', exact: true }).click();
  assert.equal(await page.getByLabel('Connection code', { exact: true }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Use a new code', exact: true }).evaluate(el => el === document.activeElement), true);
  await advanced.click();
  assert.equal(await page.getByRole('button', { name: 'Forget connection', exact: true }).isVisible(), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass('Advanced settings hides infrequent actions; keyboard, new-code focus and 320px layout remain usable');
  await connect();
  assert.equal(value(await call('create_note', sample)).reused, true);
  stored = await notes(page);
  assert.equal(stored.length, 2);
  assert.equal(stored.find(n => n.id === receipt.id).body, sample.markdown);
  pass('Reload does not auto-connect; remembered one-click reconnect preserves notes and retry deduplication');

  await page.route('**/__local_mcp/ack', route => route.abort());
  const uncertainInput = { ...sample, request_id: 'lost-receipt-001', title: '応答喪失テスト' };
  const uncertain = await call('create_note', uncertainInput);
  assert.equal(uncertain.isError, true);
  await openManual();
  await settings.getByText('Connection error', {exact:true}).waitFor();
  assert.equal((await notes(page)).length, 3);
  await page.unroute('**/__local_mcp/ack');
  await connect();
  const recovered = value(await call('create_note', uncertainInput));
  assert.equal(recovered.reused, true);
  assert.equal((await notes(page)).length, 3);
  pass('Lost save receipt is not reported as success; retry does not duplicate');

  assert.equal(value(await call('search_notes', {})).error.code, 'ACCESS_DISABLED');
  await openManual();
  await expand('Note access');
  await page.getByLabel('Allow reading and updating notes', { exact: true }).check();
  await page.keyboard.press('Escape');
  for (let attempt = 0; !value(await call('connection_status')).capabilities.includes('get_note'); attempt++) {
    assert.ok(attempt < 30); await new Promise(resolve => setTimeout(resolve, 100));
  }
  const found = value(await call('search_notes', { query: 'MCP試作', scope: 'title', tags: ['MCP'], limit: 1 }));
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, receipt.id);
  let current = value(await call('get_note', { note_id: receipt.id }));
  assert.equal(current.body, sample.markdown);
  const updateInput = { note_id: receipt.id, expected_revision: current.revision, request_id: 'access-update-001', body: 'Updated through MCP 📝' };
  assert.equal(value(await call('update_note', updateInput)).status, 'updated');
  assert.equal(value(await call('update_note', updateInput)).reused, true);
  assert.equal(value(await call('update_note', { ...updateInput, request_id: 'access-stale-001' })).error.code, 'CONFLICT');
  current = value(await call('get_note', { note_id: receipt.id }));
  assert.equal(current.body, updateInput.body);
  assert.deepEqual(current.tags, sample.tags);
  pass('Explicit access opt-in; real MCP search/get/update, metadata preservation, revision conflict and idempotent retry');

  const appendInput = { note_id: receipt.id, expected_revision: current.revision, request_id: 'access-append-001', text: '\nRepeat Repeat\nUnique' };
  assert.equal(value(await call('append_note', appendInput)).status, 'updated');
  assert.equal(value(await call('append_note', appendInput)).reused, true);
  assert.equal(value(await call('append_note', { ...appendInput, request_id: 'append-stale-001' })).error.code, 'CONFLICT');
  current = value(await call('get_note', { note_id: receipt.id }));
  assert.equal(current.body, updateInput.body + appendInput.text);
  const replaceInput = { note_id: receipt.id, expected_revision: current.revision, request_id: 'access-replace-001', search_text: 'Repeat', replacement_text: '$&$1' };
  assert.equal(value(await call('replace_note_text', replaceInput)).error.code, 'MULTIPLE_MATCHES');
  assert.equal(value(await call('replace_note_text', { ...replaceInput, search_text: 'Absent' })).error.code, 'TEXT_NOT_FOUND');
  const allInput = { ...replaceInput, mode: 'all' };
  assert.equal(value(await call('replace_note_text', allInput)).replacement_count, 2);
  assert.equal(value(await call('replace_note_text', allInput)).reused, true);
  assert.equal(value(await call('replace_note_text', { ...allInput, mode: 'single' })).error.code, 'REQUEST_ID_CONFLICT');
  current = value(await call('get_note', { note_id: receipt.id }));
  assert.equal(current.body, updateInput.body + '\n$&$1 $&$1\nUnique');
  const singleInput = { ...replaceInput, expected_revision: current.revision, request_id: 'access-single-001', search_text: 'Unique', replacement_text: '' };
  assert.equal(value(await call('replace_note_text', singleInput)).replacement_count, 1);
  assert.equal(value(await call('replace_note_text', { ...singleInput, mode: 'single' })).reused, true);
  current = value(await call('get_note', { note_id: receipt.id }));
  assert.deepEqual(current.tags, sample.tags);
  pass('Real MCP append/single/all, literal replacements, rejection without writes, counts and exact retry');

  await page.locator('.note-title', { hasText: sample.title }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Body', exact: true }).fill('Uncommitted draft');
  assert.equal(value(await call('update_note', { ...updateInput, expected_revision: current.revision, request_id: 'access-busy-001' })).error.code, 'NOTE_BUSY');
  assert.equal(value(await call('append_note', { ...appendInput, expected_revision: current.revision, request_id: 'append-busy-001' })).error.code, 'NOTE_BUSY');
  assert.equal(value(await call('replace_note_text', { ...allInput, expected_revision: current.revision, request_id: 'replace-busy-001', search_text: '$&$1' })).error.code, 'NOTE_BUSY');
  assert.equal(await page.getByRole('textbox', { name: 'Body', exact: true }).textContent(), 'Uncommitted draft');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText('Status: Saved', { exact: true }).waitFor();
  const otherTab = await context.newPage();
  await otherTab.goto(origin, { waitUntil: 'domcontentloaded' });
  await otherTab.locator('.note-title', { hasText: sample.title }).click();
  await otherTab.getByRole('button', { name: 'Edit', exact: true }).click();
  await otherTab.getByRole('textbox', { name: 'Body', exact: true }).fill('Other tab draft');
  current = value(await call('get_note', { note_id: receipt.id }));
  const crossTab = { ...updateInput, expected_revision: current.revision, request_id: 'cross-tab-001', body: 'Latest saved revision' };
  assert.equal(value(await call('update_note', crossTab)).status, 'updated');
  await page.getByRole('textbox', { name: 'Body', exact: true }).filter({ hasText: crossTab.body }).waitFor();
  await otherTab.getByRole('button', { name: /^Save$/ }).click();
  await otherTab.getByText('This note changed elsewhere. Your edits are kept. Reopen the latest note before saving.').first().waitFor();
  assert.equal(await otherTab.getByRole('textbox', { name: 'Body', exact: true }).textContent(), 'Other tab draft');
  assert.equal(value(await call('get_note', { note_id: receipt.id })).body, crossTab.body);
  await otherTab.close();
  pass('Dirty editor rejects update; clean editor refreshes; stale other-tab Save preserves draft and rejects overwrite');

  current = value(await call('get_note', { note_id: receipt.id }));
  const lostUpdate = { ...crossTab, expected_revision: current.revision, request_id: 'lost-update-001', body: 'Committed before lost ACK' };
  let lostReceipt;
  await page.route('**/__local_mcp/ack', route => { lostReceipt = route.request().postDataJSON().result; return route.abort(); });
  assert.equal(value(await call('update_note', lostUpdate)).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(lostReceipt?.status, 'updated', JSON.stringify(lostReceipt));
  await page.unroute('**/__local_mcp/ack');
  await page.reload();
  await openManual();
  await connect();
  assert.ok(value(await call('connection_status')).capabilities.includes('get_note'));
  assert.equal(value(await call('update_note', lostUpdate)).reused, true);
  assert.equal(value(await call('get_note', { note_id: receipt.id })).body, lostUpdate.body);
  pass('Lost update ACK and PWA reload preserve permission and durable receipt without repeating update');

  for (const operation of ['append_note', 'replace_note_text']) {
    current = value(await call('get_note', { note_id: receipt.id }));
    const input = { note_id: receipt.id, expected_revision: current.revision, request_id: `lost-${operation}-001`,
      ...(operation === 'append_note' ? { text: '\nEcho Echo' } : { search_text: 'Echo', replacement_text: 'Done', mode: 'all' }) };
    let committed;
    await page.route('**/__local_mcp/ack', route => { committed = route.request().postDataJSON().result; return route.abort(); });
    assert.equal(value(await call(operation, input)).error.code, 'OUTCOME_UNKNOWN');
    assert.equal(committed?.status, 'updated');
    await page.unroute('**/__local_mcp/ack');
    await page.reload();
  await openManual();
    await connect();
    assert.deepEqual(value(await call(operation, input)), { ...committed, reused: true });
    assert.equal(value(await call('get_note', { note_id: receipt.id })).body, operation === 'append_note' ? current.body + '\nEcho Echo' : current.body.replaceAll('Echo', 'Done'));
  }
  pass('Append and replace-all lost ACK/reload retries preserve the original count and never repeat the write');

  const metadataPreview = (changes, filter = { note_ids: [receipt.id, recovered.id] }) => call('preview_custom_metadata_changes', { filter, changes }).then(value);
  const metadataApply = (plan, request_id) => call('apply_custom_metadata_changes', { plan_id: plan.plan_id, request_id }).then(value);
  const beforeMetadata = await notes(page);
  const metadataPlan = await metadataPreview([{ action: 'upsert', key: 'review_status', value: 'reviewed' }, { action: 'add', key: 'nullable', value: null }]);
  assert.equal(metadataPlan.status, 'ready', JSON.stringify(metadataPlan));
  assert.equal(metadataPlan.changed_notes, 2);
  assert.deepEqual(await notes(page), beforeMetadata);
  const metadataSaved = await metadataApply(metadataPlan, 'metadata-live-001');
  assert.equal(metadataSaved.updated_notes, 2, JSON.stringify(metadataSaved));
  assert.equal(metadataSaved.added_fields, 4);
  assert.deepEqual(await metadataApply(metadataPlan, 'metadata-live-001'), { ...metadataSaved, reused: true });
  for (const id of [receipt.id, recovered.id]) {
    const prior = beforeMetadata.find(n => n.id === id);
    const saved = (await notes(page)).find(n => n.id === id);
    assert.deepEqual(saved, { ...prior, updatedAt: saved.updatedAt, customMetadata: [{ key: 'review_status', value: 'reviewed' }, { key: 'nullable', value: null }] });
  }
  const skipPlan = await metadataPreview([{ action: 'add', key: 'review_status', value: 'other' }, { action: 'update', key: 'missing', value: false }]);
  assert.equal(skipPlan.status, 'no_changes'); assert.equal(skipPlan.skipped_notes, 2);
  const samePlan = await metadataPreview([{ action: 'upsert', key: 'review_status', value: 'reviewed' }]);
  assert.equal(samePlan.unchanged_notes, 2);
  const typedPlan = await metadataPreview([{ action: 'update', key: 'nullable', value: false }], { tags: ['MCP'], custom_metadata: [{ key: 'nullable', op: 'equals', value: null }] });
  assert.equal(typedPlan.matched_notes, 2);
  assert.equal((await metadataApply(typedPlan, 'metadata-types-001')).updated_fields, 2);
  pass('Real MCP metadata preview/add/update/upsert, typed AND filters, skips, counts, atomic save and exact replay');

  await page.locator('.note-title', { hasText: sample.title }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Body', exact: true }).fill('Metadata dirty draft');
  const busyPlan = await metadataPreview([{ action: 'upsert', key: 'review_status', value: 'busy' }]);
  const beforeBusy = await notes(page);
  assert.equal((await metadataApply(busyPlan, 'metadata-busy-001')).error.code, 'NOTE_BUSY');
  assert.deepEqual(await notes(page), beforeBusy);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText('Status: Saved', { exact: true }).waitFor();
  assert.equal((await metadataApply(busyPlan, 'metadata-stale-001')).error.code, 'CONFLICT');
  pass('One dirty or changed metadata target prevents the entire batch from writing');

  const lostMetadataPlan = await metadataPreview([{ action: 'upsert', key: 'nullable', value: null }]);
  let committedMetadata;
  await page.route('**/__local_mcp/ack', route => { committedMetadata = route.request().postDataJSON().result; return route.abort(); });
  assert.equal((await metadataApply(lostMetadataPlan, 'metadata-lost-001')).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(committedMetadata?.status, 'applied');
  await page.unroute('**/__local_mcp/ack');
  await page.reload();
  await openManual(); await connect();
  assert.deepEqual(await metadataApply(lostMetadataPlan, 'metadata-lost-001'), { ...committedMetadata, reused: true });
  assert.equal((await metadataApply(lostMetadataPlan, 'metadata-newid-001')).error.code, 'PLAN_NOT_FOUND');
  pass('Metadata receipt survives lost ACK and PWA reload; a new request cannot reuse the lost session plan');

  await page.locator('.note-title', { hasText: sample.title }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Metadata', exact: true }).click();
  const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
  await metadataDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText('Status: Saved', { exact: true }).waitFor();
  assert.equal((await notes(page)).find(n => n.id === receipt.id).customMetadata.find(e => e.key === 'nullable').value, null);
  pass('MCP null metadata survives opening the metadata editor, Apply and Save');

  assert.deepEqual(value(await call('connection_status')).metadataActions, ['add', 'update', 'upsert', 'remove']);
  const beforeRemoval = await notes(page);
  const removal = await metadataPreview([{ action: 'remove', key: 'nullable' }, { action: 'remove', key: 'absent' }]);
  assert.equal(removal.changed_notes, 2, JSON.stringify(removal));
  assert.equal(removal.items[0].changes[0].before.value, null);
  assert.deepEqual(removal.items[0].changes[0].after, { exists: false });
  assert.equal(removal.items[0].changes[1].result, 'key_missing');
  assert.deepEqual(await notes(page), beforeRemoval);
  const removed = await metadataApply(removal, 'metadata-remove-001');
  assert.equal(removed.removed_fields, 2, JSON.stringify(removed));
  for (const id of [receipt.id, recovered.id]) {
    const prior = beforeRemoval.find(n => n.id === id);
    const saved = (await notes(page)).find(n => n.id === id);
    assert.deepEqual(saved, { ...prior, updatedAt: saved.updatedAt, customMetadata: prior.customMetadata.filter(e => e.key !== 'nullable') });
  }
  const allMissing = await metadataPreview([{ action: 'remove', key: 'nullable' }]);
  assert.equal(allMissing.status, 'no_changes'); assert.equal(allMissing.skipped_notes, 2);
  const readdPlan = await metadataPreview([{ action: 'upsert', key: 'nullable', value: 're-added' }]);
  const readded = await metadataApply(readdPlan, 'metadata-readd-001');
  assert.equal(Object.hasOwn(readded, 'removed_fields'), false);
  const afterReadd = await notes(page);
  assert.deepEqual(await metadataApply(removal, 'metadata-remove-001'), { ...removed, reused: true });
  assert.deepEqual(await notes(page), afterReadd);
  pass('Remove deletes keys, skips absence, preserves other data and never removes a re-added key on replay');

  const conflictingRemoval = await metadataPreview([{ action: 'remove', key: 'review_status' }]);
  const removalCurrent = value(await call('get_note', { note_id: receipt.id }));
  assert.equal(value(await call('append_note', { note_id: receipt.id, expected_revision: removalCurrent.revision, request_id: 'remove-conflict-edit-001', text: '\nRevision change' })).status, 'updated');
  const beforeRemovalConflict = await notes(page);
  assert.equal((await metadataApply(conflictingRemoval, 'remove-conflict-001')).error.code, 'CONFLICT');
  assert.deepEqual(await notes(page), beforeRemovalConflict);
  const freshRemoval = await metadataPreview([{ action: 'remove', key: 'review_status' }]);
  assert.equal((await metadataApply(freshRemoval, 'remove-fresh-001')).removed_fields, 2);
  const finalRemoval = await metadataPreview([{ action: 'remove', key: 'nullable' }]);
  let removalReceipt;
  await page.route('**/__local_mcp/ack', route => { removalReceipt = route.request().postDataJSON().result; return route.abort(); });
  assert.equal((await metadataApply(finalRemoval, 'remove-lost-001')).error.code, 'OUTCOME_UNKNOWN');
  assert.equal(removalReceipt?.removed_fields, 2);
  await page.unroute('**/__local_mcp/ack');
  await page.reload();
  await openManual(); await connect();
  assert.deepEqual(await metadataApply(finalRemoval, 'remove-lost-001'), { ...removalReceipt, reused: true });
  for (const id of [receipt.id, recovered.id]) assert.deepEqual((await notes(page)).find(n => n.id === id).customMetadata, []);
  pass('Removal is all-or-none on conflict; removing the last fields and lost ACK/reload replay preserve the original count');

  // Simulate a broker that has metadata tools but does not advertise Remove support.
  await page.route('**/__local_mcp/poll', async route => {
    // APIRequestContext does not synthesize the browser's Origin header.
    const response = await route.fetch({ headers: { ...await route.request().allHeaders(), Origin: origin } });
    assert.equal(response.status(), 200, 'The legacy-response fixture must preserve authenticated polling.');
    const payload = await response.json(); delete payload.brokerMetadataActions;
    await route.fulfill({ response, json: payload });
  });
  const beforeLegacy = await notes(page);
  assert.equal((await metadataPreview([{ action: 'remove', key: 'nullable' }])).error.code, 'UPGRADE_REQUIRED');
  assert.equal((await metadataApply(finalRemoval, 'remove-lost-001')).error.code, 'UPGRADE_REQUIRED');
  const compatible = await metadataPreview([{ action: 'upsert', key: 'legacy_compatible', value: true }]);
  assert.equal((await metadataApply(compatible, 'legacy-metadata-001')).updated_notes, 2);
  assert.equal(beforeLegacy.length, (await notes(page)).length);
  await page.unroute('**/__local_mcp/poll');
  pass('New PWA rejects removal and removal receipt replay without broker support, while legacy metadata operations still work');

  const revokedMetadataPlan = await metadataPreview([{ action: 'upsert', key: 'review_status', value: 'revoked' }]);

  await openManual();
  await expand('Note access');
  await page.getByLabel('Allow reading and updating notes', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  for (let attempt = 0; value(await call('connection_status')).capabilities.includes('get_note'); attempt++) {
    assert.ok(attempt < 30); await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(value(await call('get_note', { note_id: receipt.id })).error.code, 'ACCESS_DISABLED');
  assert.equal((await metadataApply(revokedMetadataPlan, 'metadata-revoke-001')).error.code, 'ACCESS_DISABLED');
  await openManual();
  await expand('Note access');
  await page.getByLabel('Allow reading and updating notes', { exact: true }).check();
  await page.keyboard.press('Escape');
  for (let attempt = 0; !value(await call('connection_status')).capabilities.includes('apply_custom_metadata_changes'); attempt++) {
    assert.ok(attempt < 30); await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await metadataApply(revokedMetadataPlan, 'metadata-revoke-001')).error.code, 'PLAN_NOT_FOUND');
  pass('Access can be revoked while create-only connection remains active');

  await openManual();
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).click();
  for (let attempt = 0; value(await call('connection_status')).connected; attempt++) {
    assert.ok(attempt < 50);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Model credentials expiring after a server restart, without changing the test server.
  await page.evaluate(origin => localStorage.setItem('mkb-local-mcp-connection-v1',
    JSON.stringify({ origin, token: '0'.repeat(64) })), origin);
  await page.reload();
  await openManual();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.getByText('Reconnect failed. Start your MCP client and close other connected tabs, then retry.', { exact: true }).waitFor();
  assert.equal(value(await call('connection_status')).connected, false);
  await page.getByLabel('Connection code', { exact: true }).fill(pairingCode);
  await page.getByRole('button', { name: 'Connect local MCP', exact: true }).click();
  await page.getByRole('complementary', { name: 'Local MCP', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(value(await call('connection_status')).connected, true);
  pass('Expired remembered credentials show recovery input; one new code reconnects');

  await openManual();
  assert.equal(await advanced.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByRole('button', { name: 'Forget connection', exact: true }).isVisible(), false);
  await page.screenshot({ path: fileURLToPath(new URL('../../output/playwright/local-mcp/connected.png', import.meta.url)), fullPage: true });
  await advanced.click();
  await page.getByRole('button', { name: 'Forget connection', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('mkb-local-mcp-connection-v1')), null);
  assert.equal(value(await call('connection_status')).connected, true);
  await page.getByRole('button', { name: 'Disconnect local MCP', exact: true }).click();
  for (let attempt = 0; value(await call('connection_status')).connected; attempt++) {
    assert.ok(attempt < 50);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.reload();
  await openManual();
  await page.getByLabel('Connection code', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reconnect', exact: true }).isVisible(), false);
  pass('Forget removes remembered credentials across reload without interrupting the active session');

  // Persistence can be denied independently of a successful loopback connection.
  await page.evaluate(() => {
    window.originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'mkb-local-mcp-connection-v1') throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
      return window.originalStorageSetItem.call(this, key, value);
    };
  });
  await page.getByLabel('Remember in this browser', { exact: true }).check();
  await page.getByLabel('Connection code', { exact: true }).fill(pairingCode);
  await page.getByRole('button', { name: 'Connect local MCP', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'could not remember settings' }).waitFor();
  assert.equal(value(await call('connection_status')).connected, true);
  assert.equal(await page.getByRole('complementary', { name: 'Local MCP', exact: true }).isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSetItem; delete window.originalStorageSetItem; });
  pass('Storage failure preserves the connection and leaves a visible explanation');

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
