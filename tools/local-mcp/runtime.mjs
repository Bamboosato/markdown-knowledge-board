import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createBridge } from './bridge.mjs';

// Catalog probes and chat connections must not compete for a fixed port.
const dev = process.env.MKB_MCP_DEV === '1';
const port = Number(process.env.MKB_MCP_PORT ?? (dev ? 5186 : 0));
if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) throw new Error('Invalid MKB_MCP_PORT.');
let origin;
let bridge;
let closeHttp;
if (dev) {
  const { createServer: createViteServer } = await import('vite');
  origin = `http://127.0.0.1:${port}`;
  bridge = createBridge(origin);
  const vite = await createViteServer({
    root: fileURLToPath(new URL('../../', import.meta.url)), mode: 'local-mcp', logLevel: 'silent', clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true, cors: false, open: false },
    plugins: [{ name: 'local-mcp-prototype', configureServer(server) { server.middlewares.use(bridge.middleware); } }],
  });
  await vite.listen();
  closeHttp = () => vite.close();
} else {
  const http = createServer((req, res) => {
    void bridge.middleware(req, res, () => { res.writeHead(404); res.end(); });
  });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${http.address().port}`;
  bridge = createBridge(origin, { allowedOrigins: ['https://mkb.bamboosato.com', 'https://markdown-knowledge-board.vercel.app'] });
  closeHttp = () => new Promise(resolve => { http.close(resolve); http.closeAllConnections(); });
}
const mcp = new McpServer({ name: 'mkb-local-prototype', version: '0.2.0' });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: Boolean(value.error) });
mcp.registerTool('connection_status', {
  description: 'Check the paired Markdown Knowledge Board PWA. If disconnected, returns the local server address and private one-session pairing token for the app Local MCP panel. Do not publish the token. Check browserOrigin before creating a note.',
  inputSchema: {}, annotations: { readOnlyHint: true },
}, async () => result({ ...bridge.status(), ...(!bridge.status().connected ? { pairingToken: bridge.token } : {}) }));
mcp.registerTool('create_note', {
  description: 'Create a NEW note in the explicitly paired Markdown Knowledge Board PWA on this PC. Returns saved only after IndexedDB commit. Reuse exactly the same request_id and input after uncertain delivery. Never replaces existing notes or switches the active editor.',
  inputSchema: {
    request_id: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
    title: z.string().trim().min(1).max(200),
    markdown: z.string().min(1).max(131072).refine(v => v.trim().length > 0 && Buffer.byteLength(v) <= 131072, 'Markdown must be nonempty and at most 128 KiB.'),
    tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async input => result(await bridge.create(input)));
await mcp.connect(new StdioServerTransport());
// Never log pairing tokens, note bodies or environment values.
process.stderr.write(`Local MCP bridge ready: ${origin}\n`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  bridge.close();
  await closeHttp();
  await mcp.close();
}
process.stdin.on('end', () => void stop());
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
