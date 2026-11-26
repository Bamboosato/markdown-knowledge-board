import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadIdentity } from './identity.mjs';

const SERVICE = 'mkb-local-broker-v1';
export async function connectBroker() {
  const identity = await loadIdentity();
  const origin = `http://127.0.0.1:${identity.port}`;
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
      try { await rpc('status'); return; } catch { /* Start or recover the shared service. */ }
      const child = spawn(process.execPath, [fileURLToPath(new URL('./broker.mjs', import.meta.url))], {
        detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
      });
      child.on('error', () => {});
      child.unref();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 150));
        try { await rpc('status', {}, 500); return; } catch { /* Another launcher may still be starting. */ }
      }
      throw new Error('Cannot start the local MCP service. Check the saved port; pairing was not changed.');
    })().finally(() => { starting = null; });
    return starting;
  }
  await ensure();
  const heartbeat = setInterval(() => { void ensure().catch(() => {}); }, 10000);
  heartbeat.unref();
  return {
    origin, token: identity.browserToken,
    async status() {
      await ensure();
      const status = await rpc('status');
      delete status.brokerPid;
      status.brokerMetadataActions ??= status.brokerCapabilities?.includes('preview_custom_metadata_changes') ? ['add', 'update', 'upsert'] : [];
      status.metadataActions ??= status.capabilities?.includes('preview_custom_metadata_changes') ? ['add', 'update', 'upsert'] : [];
      return { ...status, persistentPairing: true };
    },
    async ensureConnection() {
      await ensure();
      const status=await rpc('status');
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
