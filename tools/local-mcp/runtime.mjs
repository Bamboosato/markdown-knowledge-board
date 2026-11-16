import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridge } from './bridge.mjs';
import { connectBroker } from './broker-client.mjs';
import { noteShape } from './note-schema.mjs';

// Production clients share one persistent identity and one authenticated loopback service.
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
  bridge = await connectBroker();
  origin = bridge.origin;
  closeHttp = async () => {};
}
const mcp = new McpServer({ name: 'mkb-local-prototype', version: '0.3.0' });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: Boolean(value.error) });
mcp.registerTool('connection_status', {
  description: 'Check this PC shared Markdown Knowledge Board connection. Pairing survives Codex and PC restarts: use Reconnect in the paired PWA. If disconnected, returns a private pairingCode for first setup only. Share it only with this user, never publish it. Multiple Codex chats on this PC share the paired PWA. Check browserOrigin before creating a note.',
  inputSchema: {}, annotations: { readOnlyHint: true },
}, async () => { const status = await bridge.status(); return result({ ...status, ...(!status.connected ? {
  pairingToken: bridge.token, pairingCode: `MKB1|${origin}|${bridge.token}`,
} : {}) }); });
mcp.registerTool('create_note', {
  description: 'Create a NEW note in the explicitly paired Markdown Knowledge Board PWA on this PC. Returns saved only after IndexedDB commit. Reuse exactly the same request_id and input after uncertain delivery. Never replaces existing notes or switches the active editor.',
  inputSchema: noteShape,
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
