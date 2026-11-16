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
      return { ...status, persistentPairing: true };
    },
    async create(input) {
      try {
        await ensure();
        return await rpc('create', input, 20000);
      } catch {
        // Never replay a write automatically: it may have reached IndexedDB before the failure.
        return { error: 'Service unavailable. Save outcome may be unknown; reconnect and retry the same request_id.' };
      }
    },
    close() { clearInterval(heartbeat); },
  };
}
