import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createBridge } from './bridge.mjs';
import { accessSchemas } from './note-schema.mjs';

const origin = 'http://127.0.0.1:5186';
const clientId = '00000000-0000-4000-8000-000000000001';
const input = { request_id: 'test-request', title: '架空のノート 📝', markdown: '# Synthetic', tags: [] };
const supported = ['create_note', ...Object.keys(accessSchemas)];
async function request(bridge, path, body = {}, headers = {}) {
  // Deliberately split UTF-8 characters across chunks, as TCP is allowed to do.
  const req = Readable.from(Array.from(Buffer.from(JSON.stringify({ clientId, ...body })), byte => Buffer.from([byte])));
  Object.assign(req, {
    method: 'POST', url: `/__local_mcp/${path}`,
    headers: { host: '127.0.0.1:5186', origin, authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json', ...headers },
  });
  let status;
  let value;
  await bridge.middleware(req, {
    writeHead(code) { status = code; },
    end(raw) { value = JSON.parse(raw); },
  }, () => assert.fail('Unexpected middleware fallthrough'));
  return { status, value };
}

test('requires token, exact Origin and Host, and JSON POST', async () => {
  const bridge = createBridge(origin);
  for (const headers of [
    { authorization: 'Bearer incorrect' }, { origin: 'https://example.com' },
    { host: 'rebound.example:5186' }, { 'content-type': 'text/plain' },
  ]) assert.equal((await request(bridge, 'connect', {}, headers)).status, 403);
  assert.equal(bridge.status().connected, false);
});

test('does not accept another tab while connected or a second pending write', async () => {
  const bridge = createBridge(origin);
  await request(bridge, 'connect');
  assert.equal((await request(bridge, 'connect', { clientId: '00000000-0000-4000-8000-000000000002' })).status, 409);
  const pending = bridge.create(input);
  assert.match((await bridge.create(input)).error, /in progress/);
  bridge.close();
  assert.ok((await pending).error);
});

test('returns success only after a matching browser receipt', async () => {
  const bridge = createBridge(origin);
  await request(bridge, 'connect');
  let completed = false;
  const pending = bridge.create(input).then(value => { completed = true; return value; });
  const { job } = (await request(bridge, 'poll')).value;
  assert.deepEqual(job.input, input);
  assert.equal(completed, false);
  assert.equal((await request(bridge, 'ack', { deliveryId: 'stale', result: {} })).status, 409);
  assert.equal(completed, false);
  await request(bridge, 'ack', { deliveryId: job.deliveryId, result: { id: 'mcp-test', title: input.title, reused: false } });
  const saved = await pending;
  assert.equal(saved.status, 'saved');
  assert.equal(saved.title, input.title);
});

test('timeout is unknown, not success; a stale receipt cannot complete the next request', async () => {
  const bridge = createBridge(origin, { timeoutMs: 20 });
  await request(bridge, 'connect');
  const first = bridge.create(input);
  const oldJob = (await request(bridge, 'poll')).value.job;
  assert.match((await first).error, /Outcome is unknown/);
  const second = bridge.create(input);
  assert.equal((await request(bridge, 'ack', { deliveryId: oldJob.deliveryId, result: { id: 'mcp-test', title: 'Synthetic', reused: false } })).status, 409);
  bridge.close();
  assert.ok((await second).error);
});

test('browser save failure and disconnect cannot produce success', async () => {
  const bridge = createBridge(origin);
  await request(bridge, 'connect');
  const failed = bridge.create(input);
  const { job } = (await request(bridge, 'poll')).value;
  await request(bridge, 'ack', { deliveryId: job.deliveryId, result: { error: 'SAVE_FAILED' } });
  assert.match((await failed).error, /could not save/);
  const disconnected = bridge.create(input);
  await request(bridge, 'disconnect');
  assert.match((await disconnected).error, /unknown/);
  assert.equal(bridge.status().connected, false);
});

test('production CORS allows only configured origins, and binds pairing to its origin', async () => {
  const production = 'https://mkb.bamboosato.com';
  const other = 'https://markdown-knowledge-board.vercel.app';
  const bridge = createBridge(origin, { allowedOrigins: [production, other] });
  assert.equal((await request(bridge, 'connect')).status, 403);
  assert.equal((await request(bridge, 'connect', {}, { origin: production })).status, 200);
  assert.equal(bridge.status().browserOrigin, production);
  assert.equal((await request(bridge, 'poll', {}, { origin: other })).status, 409);
  for (const source of [production, 'https://untrusted.example']) {
    const headers = {};
    let status;
    await bridge.middleware({ method: 'OPTIONS', url: '/__local_mcp/connect', headers: {
      host: '127.0.0.1:5186', origin: source, 'access-control-request-method': 'POST',
    } }, { setHeader(key, value) { headers[key] = value; }, writeHead(code) { status = code; }, end() {} }, () => assert.fail());
    assert.equal(status, source === production ? 200 : 403);
    assert.equal(headers['Access-Control-Allow-Origin'], source === production ? production : undefined);
  }
  bridge.close();
});

test('existing note access requires upgraded browser and explicit permission', async () => {
  const bridge = createBridge(origin);
  assert.equal((await bridge.execute('search_notes', {})).error.code, 'NOT_CONNECTED');
  await request(bridge, 'connect');
  assert.equal((await bridge.execute('search_notes', {})).error.code, 'UPGRADE_REQUIRED');
  await request(bridge, 'poll', { protocolVersion: 2, noteAccess: false });
  assert.equal((await bridge.execute('search_notes', {})).error.code, 'ACCESS_DISABLED');
  await request(bridge, 'permissions', { noteAccess: true });
  assert.ok(bridge.status().capabilities.includes('get_note'));
  assert.equal((await bridge.execute('get_note', { note_id: 'x', extra: true })).error.code, 'INVALID_ARGUMENT');
  const pending = bridge.execute('get_note', { note_id: 'ordinary-id' });
  assert.equal((await bridge.execute('search_notes', {})).error.code, 'BUSY');
  const { job } = (await request(bridge, 'poll', { protocolVersion: 2, noteAccess: true })).value;
  const result = { id: 'ordinary-id', title: 'Existing', body: 'あ'.repeat(10000), tags: [], updated_at: 1, revision: `v1-${'a'.repeat(64)}`, body_bytes: 30000 };
  assert.equal((await request(bridge, 'ack', { deliveryId: job.deliveryId, result: { ...result, id: 'wrong' } })).status, 400);
  assert.equal((await request(bridge, 'ack', { deliveryId: job.deliveryId, result })).status, 200);
  assert.deepEqual(await pending, result);
  await request(bridge, 'permissions', { noteAccess: false });
  assert.equal((await bridge.execute('search_notes', {})).error.code, 'ACCESS_DISABLED');
  bridge.close();
});

test('access disconnect and timeout return structured unknown outcomes', async () => {
  const bridge = createBridge(origin, { timeoutMs: 20 });
  await request(bridge, 'connect', { protocolVersion: 2, noteAccess: true });
  assert.equal((await bridge.execute('search_notes', {})).error.code, 'OUTCOME_UNKNOWN');
  const pending = bridge.execute('get_note', { note_id: 'x' });
  bridge.close();
  assert.equal((await pending).error.code, 'OUTCOME_UNKNOWN');
});

test('negotiates old, empty, partial and new PWA capabilities without dispatching unsupported edits', async () => {
  const bridge = createBridge(origin);
  const edit = { note_id: 'x', request_id: 'append-0001', expected_revision: `v1-${'a'.repeat(64)}`, text: 'x' };
  assert.deepEqual(bridge.status().brokerCapabilities, supported);
  await request(bridge, 'connect', { protocolVersion: 2, noteAccess: true });
  assert.deepEqual(bridge.status().capabilities, ['create_note', 'search_notes', 'get_note', 'update_note']);
  assert.equal((await bridge.execute('append_note', edit)).error.code, 'UPGRADE_REQUIRED');
  assert.equal(bridge.status().busy, false);
  assert.equal((await request(bridge, 'poll', { protocolVersion: 2, noteAccess: true, supportedOperations: 'invalid' })).status, 400);
  await request(bridge, 'poll', { protocolVersion: 2, noteAccess: true, supportedOperations: [] });
  assert.deepEqual(bridge.status().capabilities, []);
  assert.ok((await bridge.create(input)).error);
  await request(bridge, 'poll', { protocolVersion: 2, noteAccess: true, supportedOperations: [...supported, 'unknown'] });
  assert.deepEqual(bridge.status().capabilities, supported);
  await request(bridge, 'permissions', { noteAccess: false });
  assert.deepEqual(bridge.status().capabilities, ['create_note']);
  assert.equal((await bridge.execute('append_note', edit)).error.code, 'ACCESS_DISABLED');
  bridge.close();
});

test('validates new mutation receipts, counts and structured errors', async () => {
  const bridge = createBridge(origin);
  await request(bridge, 'connect', { protocolVersion: 2, noteAccess: true, supportedOperations: supported });
  const revision = `v1-${'a'.repeat(64)}`;
  const edit = { note_id: 'x', request_id: 'replace-0001', expected_revision: revision, search_text: 'a', replacement_text: 'b', mode: 'all' };
  const pending = bridge.execute('replace_note_text', edit);
  const { job } = (await request(bridge, 'poll', { protocolVersion: 2, noteAccess: true, supportedOperations: supported })).value;
  const receipt = { status: 'updated', id: 'x', title: 'Test', previous_revision: revision, revision, updated_at: 1, reused: false };
  assert.equal((await request(bridge, 'ack', { deliveryId: job.deliveryId, result: receipt })).status, 400);
  assert.equal((await request(bridge, 'ack', { deliveryId: job.deliveryId, result: { ...receipt, replacement_count: 0 } })).status, 400);
  const result = { ...receipt, replacement_count: 3 };
  assert.equal((await request(bridge, 'ack', { deliveryId: job.deliveryId, result })).status, 200);
  assert.deepEqual(await pending, result);
  for (const code of ['TEXT_NOT_FOUND', 'MULTIPLE_MATCHES', 'RESULT_TOO_LARGE']) {
    const failure = bridge.execute('replace_note_text', edit);
    const { job } = (await request(bridge, 'poll', { protocolVersion: 2, noteAccess: true, supportedOperations: supported })).value;
    const error = { error: { code, message: 'No update.' } };
    assert.equal((await request(bridge, 'ack', { deliveryId: job.deliveryId, result: error })).status, 200);
    assert.deepEqual(await failure, error);
  }
  assert.equal((await bridge.execute('replace_note_text', { ...edit, expected_count: 3 })).error.code, 'INVALID_ARGUMENT');
  bridge.close();
});
