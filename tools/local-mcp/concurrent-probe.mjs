// Production-process lifecycle probe. Synthetic browser receipts; no real user data.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadIdentity } from './identity.mjs';

const directory = fileURLToPath(new URL(`../../output/local-mcp/lifecycle-${randomUUID()}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const clients = [];
const pids = new Set();
const checks = [];
const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
const unwrap = result => JSON.parse(result.content[0].text);
const status = async client => unwrap(await client.callTool({ name: 'connection_status', arguments: {} }));
async function start(stateDir = directory) {
  const client = new Client({ name: 'persistent-pairing-probe', version: '1' });
  clients.push(client);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], stderr: 'pipe',
    env: { ...process.env, MKB_MCP_STATE_DIR: stateDir, MKB_MCP_PORT: String(port), MKB_MCP_DEV: '0' } });
  await client.connect(transport);
  return client;
}
async function admin(identity, operation, input = {}, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/__local_mcp_admin/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.serverToken}`, ...headers },
    body: JSON.stringify(input), signal: AbortSignal.timeout(20000),
  });
}
async function pid(identity) {
  const value = (await (await admin(identity, 'status')).json()).value;
  pids.add(value.brokerPid);
  return value.brokerPid;
}
function stopPid(id) {
  try { process.kill(id); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  pids.delete(id);
}
async function browser(setup, operation, clientId, input = {}) {
  const response = await fetch(`${setup.origin}/__local_mcp/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mkb.bamboosato.com', Authorization: `Bearer ${setup.pairingToken}` },
    body: JSON.stringify({ clientId, ...input }), signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  const [one, two] = await Promise.all([start(), start()]);
  const [first, second] = await Promise.all([status(one), status(two)]);
  assert.equal(first.origin, second.origin);
  assert.equal(first.pairingToken, second.pairingToken);
  assert.equal(first.persistentPairing, true);
  const identity = JSON.parse(await readFile(`${directory}/identity.json`, 'utf8'));
  const originalFile = await readFile(`${directory}/identity.json`, 'utf8');
  const firstPid = await pid(identity);
  pass('Concurrent MCP clients share one atomically installed identity and service');

  assert.equal((await admin(identity, 'status', {}, { Authorization: `Bearer ${identity.browserToken}` })).status, 403);
  assert.equal((await admin(identity, 'status', {}, { Origin: 'https://mkb.bamboosato.com' })).status, 403);
  assert.equal((await admin(identity, 'create', { title: 'Invalid' })).status, 400);
  pass('Browser token and browser Origin cannot use MCP control endpoints; invalid writes rejected');

  const tab = randomUUID();
  await browser(first, 'connect', tab);
  assert.equal((await status(two)).connected, true);
  const input = { request_id: 'persistent-probe-001', title: 'Synthetic lifecycle note', markdown: '# Synthetic', tags: [] };
  const pending = two.callTool({ name: 'create_note', arguments: input });
  let job;
  for (let attempt = 0; !job; attempt++) {
    assert.ok(attempt < 50);
    job = (await browser(first, 'poll', tab)).job;
    if (!job) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(job.input, input);
  await browser(first, 'ack', tab, { deliveryId: job.deliveryId,
    result: { id: 'mcp-synthetic-receipt', title: input.title, reused: false } });
  assert.equal(unwrap(await pending).status, 'saved');
  await one.close();
  assert.equal((await status(two)).connected, true);
  pass('A second MCP client can deliver through the paired tab; closing one client leaves it connected');

  const interrupted = two.callTool({ name: 'create_note', arguments: { ...input, request_id: 'interrupted-probe-001' } });
  for (let attempt = 0; !(await browser(first, 'poll', tab)).job; attempt++) {
    assert.ok(attempt < 50);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  stopPid(firstPid);
  const uncertain = await interrupted;
  assert.equal(uncertain.isError, true);
  assert.match(unwrap(uncertain).error, /unknown/);
  const recovered = await status(two);
  assert.equal(recovered.origin, first.origin);
  assert.equal(recovered.pairingToken, first.pairingToken);
  await pid(identity);
  await browser(first, 'connect', randomUUID());
  assert.equal((await status(two)).connected, true);
  pass('Service crash reports unknown save outcome; original pairing reconnects after recovery');

  await two.close();
  const beforeRestartPid = await pid(identity);
  stopPid(beforeRestartPid);
  const restarted = await start();
  const restartedStatus = await status(restarted);
  assert.equal(restartedStatus.origin, first.origin);
  assert.equal(restartedStatus.pairingToken, first.pairingToken);
  await pid(identity);
  await browser(first, 'connect', randomUUID());
  assert.equal((await status(restarted)).connected, true);
  assert.equal(await readFile(`${directory}/identity.json`, 'utf8'), originalFile);
  pass('All MCP and service processes restart; original pairing works without a new code');

  const corruptDirectory = `${directory}/corrupt`;
  await mkdir(corruptDirectory);
  await writeFile(`${corruptDirectory}/identity.json`, '{broken');
  await assert.rejects(loadIdentity({ directory: corruptDirectory }), /Invalid local MCP identity/);
  assert.equal(await readFile(`${corruptDirectory}/identity.json`, 'utf8'), '{broken');
  pass('Corrupt identity is not silently replaced');

  const occupied = createHttpServer((_req, res) => { res.writeHead(403); res.end(); });
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const blockedDirectory = `${directory}/occupied`;
  await loadIdentity({ directory: blockedDirectory, seed: { port: occupied.address().port } });
  const blockedBefore = await readFile(`${blockedDirectory}/identity.json`, 'utf8');
  try {
    await assert.rejects(start(blockedDirectory));
    assert.equal(await readFile(`${blockedDirectory}/identity.json`, 'utf8'), blockedBefore);
    pass('An occupied port fails without changing the saved port or pairing');
  } finally {
    occupied.closeAllConnections();
    await new Promise(resolve => occupied.close(resolve));
  }
  await writeFile(new URL('../../output/local-mcp/lifecycle-result.json', import.meta.url), JSON.stringify({
    checkedAt: new Date().toISOString(), checks,
  }, null, 2));
} catch (error) {
  console.error(String(error.stack ?? error).replace(/[a-f0-9]{64}/g, '[redacted]'));
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  for (const id of pids) stopPid(id);
}
