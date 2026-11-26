import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadIdentity, stateDirectory } from './identity.mjs';
import {configuredBroker, installedPairingOperations, pairingHandoff, pairingOperations, supportsPairing} from './pairing.mjs';

const SERVICE = 'mkb-local-broker-v1';
function publicStatus(snapshot) {
  const status={...snapshot};
  delete status.handoffInstance;
  delete status.brokerPid;
  status.brokerMetadataActions ??= status.brokerCapabilities?.includes('preview_custom_metadata_changes') ? ['add', 'update', 'upsert'] : [];
  status.metadataActions ??= status.capabilities?.includes('preview_custom_metadata_changes') ? ['add', 'update', 'upsert'] : [];
  return { ...status, persistentPairing: true };
}

export async function connectBroker() {
  const identity = await loadIdentity();
  const origin = `http://127.0.0.1:${identity.port}`;
  const handoff = pairingHandoff(stateDirectory());
  const required = pairingOperations(process.platform === 'win32');
  async function rpc(operation, input = {}, timeout = 2000) {
    const response = await fetch(`${origin}/__local_mcp_admin/${operation}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.serverToken}` },
      body: JSON.stringify(input), signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    if (!response.ok) throw new Error('Local MCP service authentication failed or port is occupied.');
    const payload = await response.json();
    if (payload.service !== SERVICE) throw new Error('Unrecognized local MCP service.');
    return payload.value;
  }
  let starting;
  async function ensure() {
    if (starting) return starting;
    starting = (async () => {
      try { return await rpc('status'); } catch { /* Start or recover the shared service. */ }
      const child = spawn(process.execPath, [fileURLToPath(await configuredBroker())], {
        detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
      });
      child.on('error', () => {});
      child.unref();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 150));
        try { return await rpc('status', {}, 500); } catch { /* Another launcher may still be starting. */ }
      }
      throw new Error('Cannot start the local MCP service. Check the saved port; pairing was not changed.');
    })().finally(() => { starting = null; });
    return starting;
  }
  async function heartbeatCheck() {
    if (!await handoff.waiting()) await ensure();
  }
  await heartbeatCheck();
  const heartbeat = setInterval(() => { void heartbeatCheck().catch(() => {}); }, 10000);
  heartbeat.unref();
  const waiting = {code:'PAIRING_PREPARING',retryAfterMs:40000,message:'The installed runtime is taking over after the old service becomes idle. Retry the connection code request in 40 seconds.'};
  const retry = {code:'PAIRING_IN_USE',message:'The current service is in use. Finish pending saves and disconnect the MKB tab, then request the code again.'};
  async function pairingStatus(includeCode) {
    if (await handoff.waiting()) return {error:waiting};
    let status = await ensure();
    if ((includeCode || !status.connected) && !supportsPairing(status.pairingOperations,required)) {
      let offered;
      try { offered=await installedPairingOperations(await configuredBroker()); }
      catch { return {error:{code:'PAIRING_RUNTIME_UNAVAILABLE',message:'The configured local MCP runtime could not be loaded. Check its installation and dependencies, then retry.'}}; }
      if (!supportsPairing(offered,required)) {
        return {error:{code:'PAIRING_UPDATE_REQUIRED',message:'The configured local runtime does not provide the required pairing features. Update it or select a compatible installation and restart the MCP client.'}};
      }
      if (Array.isArray(status.pairingOperations) && !supportsPairing(offered,status.pairingOperations)) {
        return {error:{code:'PAIRING_RUNTIME_CONFLICT',message:'The running and installed services provide different pairing features. Select one runtime that supports both before switching.'}};
      }
      if (status.connected || status.busy) return {error:retry};
      if (status.connected !== false || status.busy !== false) return {error:{code:'PAIRING_RESTART_REQUIRED',message:'Cannot confirm that the old service is idle. Finish pending saves, close the MKB MCP clients, then restart after 35 seconds.'}};
      if (!status.handoffInstance) {
        const state = await handoff.begin();
        return {error:state === 'waiting' ? waiting : {code:'PAIRING_RESTART_REQUIRED',message:'An older MCP client is keeping the old service running. Close all MKB MCP clients, wait 35 seconds, then reopen your client. The compatible runtime is already installed.'}};
      }
      try {
        const result = await rpc('retire-for-pairing',{instance:status.handoffInstance,required});
        if (result.busy) return {error:retry};
      } catch { /* Another client may have completed the same handoff. Verify the winner. */ }
      status = await ensure();
      if (!supportsPairing(status.pairingOperations,required)) return {error:{code:'PAIRING_RETRY',message:'The service has not switched yet. Request the code again after pending operations finish.'}};
    }
    return publicStatus(status);
  }
  return {
    origin, token: identity.browserToken,
    status: async () => publicStatus(await ensure()),
    pairingStatus,
    async ensureConnection() {
      const status=await ensure();
      if (!Object.hasOwn(status,'automatic')) return status.connected ? null : 'UPGRADE_REQUIRED';
      return (await rpc('ensure',{},22000)).error ?? null;
    },
    async create(input) {
      try {
        await ensure();
        return await rpc('create', input, 38000);
      } catch {
        // Never replay a write automatically: it may have reached IndexedDB before the failure.
        return { error: 'Service unavailable. Save outcome may be unknown; reconnect and retry the same request_id.' };
      }
    },
    async execute(operation, input) {
      try {
        await ensure();
        const status = await rpc('status');
        if (status.protocolVersion !== 2 || (['append_note', 'replace_note_text', 'preview_custom_metadata_changes', 'apply_custom_metadata_changes'].includes(operation) && !status.brokerCapabilities?.includes(operation))) return { error: { code: 'UPGRADE_REQUIRED', message: 'Close all local MCP clients, wait 35 seconds, then restart to update the shared service.' } };
        if (operation === 'preview_custom_metadata_changes' && input.changes?.some(c => c.action === 'remove') && !status.brokerMetadataActions?.includes('remove')) return { error: { code: 'UPGRADE_REQUIRED', message: 'Restart all local MCP clients to update the shared service before removing Custom metadata.' } };
        return await rpc('execute', { operation, input }, 20000);
      } catch {
        return { error: { code: 'OUTCOME_UNKNOWN', message: 'Service unavailable. Reconnect; retry an update with exactly the same request_id and input.' } };
      }
    },
    close() { clearInterval(heartbeat); },
  };
}
