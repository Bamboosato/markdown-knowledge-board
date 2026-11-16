import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createBridge } from './bridge.mjs';

const origin = 'http://127.0.0.1:5186';
const clientId = '00000000-0000-4000-8000-000000000001';
const input = { request_id: 'test-request', title: '架空のノート 📝', markdown: '# Synthetic', tags: [] };
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
