import { createServer } from 'node:http';
import { createBridge } from './bridge.mjs';
import { loadIdentity } from './identity.mjs';
import { noteSchema } from './note-schema.mjs';

export const SERVICE = 'mkb-local-broker-v1';
const identity = await loadIdentity();
const origin = `http://127.0.0.1:${identity.port}`;
const bridge = createBridge(origin, { token: identity.browserToken,
  allowedOrigins: ['https://mkb.bamboosato.com', 'https://markdown-knowledge-board.vercel.app'] });
let lastMcpActivity = Date.now();
const http = createServer((req, res) => {
  if (!req.url?.startsWith('/__local_mcp_admin/')) {
    void bridge.middleware(req, res, () => { res.writeHead(404); res.end(); });
    return;
  }
  const send = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ service: SERVICE, value }));
  };
  // The browser pairing token cannot call the MCP-side API; no browser Origin or CORS.
  if (req.headers.host !== new URL(origin).host || req.headers.origin !== undefined ||
      req.method !== 'POST' || req.headers.authorization !== `Bearer ${identity.serverToken}` ||
      req.headers['content-type'] !== 'application/json') { send(403, { error: 'Rejected.' }); return; }
  void (async () => {
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1048576) { send(413, { error: 'Request too large.' }); return; }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      lastMcpActivity = Date.now();
      if (req.url === '/__local_mcp_admin/status') {
        send(200, { ...bridge.status(), brokerPid: process.pid });
      } else if (req.url === '/__local_mcp_admin/create') {
        const parsed = noteSchema.safeParse(input);
        if (!parsed.success) { send(400, { error: 'Invalid note input.' }); return; }
        send(200, await bridge.create(parsed.data));
      } else send(404, { error: 'Unknown operation.' });
    } catch { if (!res.headersSent) send(400, { error: 'Invalid request.' }); }
  })();
});
http.requestTimeout = 20000;
http.headersTimeout = 10000;
http.on('error', error => {
  // A concurrent launcher may already own the same service; clients authenticate it.
  if (error.code !== 'EADDRINUSE') process.stderr.write(`Local MCP service failed: ${error.code ?? 'ERROR'}\n`);
  process.exit(error.code === 'EADDRINUSE' ? 0 : 1);
});
http.listen(identity.port, '127.0.0.1');
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(idleTimer);
  bridge.close();
  http.close();
  http.closeAllConnections();
}
// Browser polling does not keep the service running after every Codex client exits.
const idleTimer = setInterval(() => {
  if (Date.now() - lastMcpActivity > 30000 && !bridge.status().busy) stop();
}, 5000);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
