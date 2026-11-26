// Production-process lifecycle probe. Synthetic browser receipts; no real user data.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
async function start(stateDir = directory, entry = fileURLToPath(new URL('./server.mjs', import.meta.url))) {
  const client = new Client({ name: 'persistent-pairing-probe', version: '1' });
  clients.push(client);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [entry], stderr: 'pipe',
    env: { ...process.env, MKB_MCP_STATE_DIR: stateDir, MKB_MCP_PORT: String(port), MKB_MCP_DEV: '0' } });
  await client.connect(transport);
  return client;
}
async function admin(identity, operation, input = {}, headers = {}) {
  return fetch(`http://127.0.0.1:${identity.port}/__local_mcp_admin/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.serverToken}`, ...headers },
    body: JSON.stringify(input), signal: AbortSignal.timeout(20000),
  });
}
async function pid(identity) {
  const reply=await admin(identity,'status');
  assert.equal(reply.status,200,'Test broker must accept status after a handoff');
  const value = (await reply.json()).value;
  assert.ok(Number.isInteger(value.brokerPid) && value.brokerPid > 0,'Expected the test broker PID');
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
  const running=(await (await admin(identity,'status')).json()).value;
  const retirement=await admin(identity,'retire-for-pairing',{instance:running.handoffInstance,required:['future-pairing']});
  assert.deepEqual((await retirement.json()).value,{busy:true});
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

  let unsupportedDispatches = 0;
  let legacyStatus = { protocolVersion: 2, connected: true, capabilities: ['create_note', 'search_notes', 'get_note', 'update_note'] };
  const legacy = createHttpServer((req, res) => {
    if (req.url.endsWith('/execute')) unsupportedDispatches++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'mkb-local-broker-v1', value: req.url.endsWith('/execute') ? { status: 'no_matches', plan_id: null, items: [], matched_notes: 0, changed_notes: 0, unchanged_notes: 0, skipped_notes: 0 } : legacyStatus }));
  });
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve));
  const legacyDirectory = `${directory}/legacy`;
  await loadIdentity({ directory: legacyDirectory, seed: { port: legacy.address().port } });
  let legacyClient;
  try {
    legacyClient = await start(legacyDirectory);
    for (const name of ['append_note', 'replace_note_text', 'preview_custom_metadata_changes', 'apply_custom_metadata_changes']) {
      const args = name === 'preview_custom_metadata_changes' ? { filter: { all_notes: true }, changes: [{ action: 'upsert', key: 'x', value: null }] }
        : name === 'apply_custom_metadata_changes' ? { plan_id: `cmdp_${randomUUID()}`, request_id: 'legacy-check-001' }
        : { note_id: 'x', expected_revision: `v1-${'a'.repeat(64)}`, request_id: 'legacy-check-001',
          ...(name === 'append_note' ? { text: 'x' } : { search_text: 'a', replacement_text: 'b' }) };
      assert.equal(unwrap(await legacyClient.callTool({ name, arguments: args })).error.code, 'UPGRADE_REQUIRED');
    }
    assert.equal(unsupportedDispatches, 0);
    pass('New runtime rejects text and metadata edits against a legacy broker before dispatch');
    legacyStatus = { ...legacyStatus, brokerCapabilities: ['create_note', 'preview_custom_metadata_changes', 'apply_custom_metadata_changes'], capabilities: ['create_note', 'preview_custom_metadata_changes', 'apply_custom_metadata_changes'] };
    const removal = { filter: { all_notes: true }, changes: [{ action: 'remove', key: 'source' }] };
    assert.equal(unwrap(await legacyClient.callTool({ name: 'preview_custom_metadata_changes', arguments: removal })).error.code, 'UPGRADE_REQUIRED');
    assert.equal(unsupportedDispatches, 0);
    assert.deepEqual((await status(legacyClient)).metadataActions, ['add', 'update', 'upsert']);
    const existing = { ...removal, changes: [{ action: 'upsert', key: 'source', value: null }] };
    assert.equal(unwrap(await legacyClient.callTool({ name: 'preview_custom_metadata_changes', arguments: existing })).status, 'no_matches');
    assert.equal(unsupportedDispatches, 1);
    pass('Runtime rejects remove against a 0.6 broker while preserving existing metadata actions');
    const askCode=async client=>unwrap(await client.callTool({name:'connection_status',arguments:{include_pairing_code:true}}));
    const inUse=await askCode(legacyClient);
    assert.equal(inUse.error.code,'PAIRING_IN_USE');
    assert.equal(inUse.pairingCode,undefined);
    legacyStatus={...legacyStatus,connected:false,busy:false};

    // The installed launcher selects a versioned runtime. A confirmed missing capability
    // must not retire the running broker or disclose credentials.
    const kit=legacyDirectory+'/kit';
    const selected=kit+'/runtimes/test/tools/local-mcp';
    await mkdir(selected,{recursive:true});
    const launcher=kit+'/start-mcp.mjs';
    await writeFile(launcher,'await import('+JSON.stringify(pathToFileURL(selected+'/server.mjs').href)+');');
    await writeFile(selected+'/server.mjs','await import('+JSON.stringify(new URL('./server.mjs',import.meta.url).href)+');');
    await writeFile(selected+'/broker.mjs','export const availablePairingOperations=[];');
    const kitClient=await start(legacyDirectory,launcher);
    const update=await askCode(kitClient);
    assert.equal(update.error.code,'PAIRING_UPDATE_REQUIRED');
    assert.equal(update.pairingToken,undefined);
    await kitClient.close();
    const peer=await start(legacyDirectory);
    const before=await readFile(legacyDirectory+'/identity.json','utf8');
    for (const reply of await Promise.all([askCode(peer),askCode(legacyClient)])) {
      assert.equal(reply.error.code,'PAIRING_PREPARING');
      assert.equal(reply.pairingCode,undefined);
    }
    assert.equal((await askCode(peer)).error.code,'PAIRING_PREPARING');
    // Model a pre-handoff broker's existing idle shutdown; heartbeats or status rechecks
    // during its quiet window would renew the old service and defeat the migration.
    let renewals=0;
    legacy.on('request',()=>{renewals++;});
    await new Promise(resolve=>setTimeout(resolve,35000));
    assert.equal(renewals,0);
    legacy.closeAllConnections();
    await new Promise(resolve=>legacy.close(resolve));
    await new Promise(resolve=>setTimeout(resolve,4000));
    const [left,right]=await Promise.all([askCode(peer),askCode(legacyClient)]);
    assert.ok(left.pairingCode && left.pairingCode===right.pairingCode);
    assert.equal(left.pairingToken,JSON.parse(before).browserToken);
    assert.equal(await readFile(legacyDirectory+'/identity.json','utf8'),before);
    const recoveredIdentity=JSON.parse(before);
    const previousPid=await pid(recoveredIdentity);
    const live=(await (await admin(recoveredIdentity,'status')).json()).value;
    const retirement=await admin(recoveredIdentity,'retire-for-pairing',{instance:live.handoffInstance,required:['future-pairing']});
    assert.equal(retirement.status,200,'Idle broker must confirm retirement');
    assert.deepEqual((await retirement.json()).value,{retired:true});
    pids.delete(previousPid);
    assert.equal((await askCode(peer)).pairingCode,left.pairingCode);
    assert.notEqual(await pid(recoveredIdentity),previousPid);
    await peer.close();
    pass('Pairing checks distinguish missing runtime, active service and automatic idle migration across clients; pairing is preserved');
  } finally {
    await legacyClient?.close();
    legacy.closeAllConnections();
    if (legacy.listening) await new Promise(resolve => legacy.close(resolve));
  }

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
