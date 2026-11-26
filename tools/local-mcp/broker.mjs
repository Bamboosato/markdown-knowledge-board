import { createServer } from 'node:http';
import {pathToFileURL} from 'node:url';
import { createBridge } from './bridge.mjs';
import { loadIdentity, stateDirectory } from './identity.mjs';
import { autoOpen } from './auto-open.mjs';
import { noteSchema, accessSchemas } from './note-schema.mjs';

export const SERVICE = 'mkb-local-broker-v1';
export function startBroker(identity,allowedOrigins,auto) {
  const origin = `http://127.0.0.1:${identity.port}`;
  const bridge=createBridge(origin,{token:identity.browserToken,allowedOrigins,auto});
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
        } else if (req.url === '/__local_mcp_admin/ensure') {
          const error=await bridge.ensureConnection();
          send(200,error ? {error} : bridge.status());
        } else if (req.url === '/__local_mcp_admin/create') {
          const parsed = noteSchema.safeParse(input);
          if (!parsed.success) { send(400, { error: 'Invalid note input.' }); return; }
          send(200, await bridge.create(parsed.data));
        } else if (req.url === '/__local_mcp_admin/execute') {
          const schema = Object.hasOwn(accessSchemas, input.operation) && accessSchemas[input.operation];
          const parsed = schema && schema.safeParse(input.input);
          if (!parsed?.success) { send(400, { error: { code: 'INVALID_ARGUMENT', message: 'Invalid note request.' } }); return; }
          send(200, await bridge.execute(input.operation, parsed.data));
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
  return {http,stop};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const identity=await loadIdentity();
  const origins=['https://mkb.bamboosato.com','https://markdown-knowledge-board.vercel.app'];
  const auto=process.platform==='win32' ? autoOpen({directory:stateDirectory(),origins}) : undefined;
  const {stop}=startBroker(identity,origins,auto);
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
}
