// Interactive MCP client fallback. stdin accepts {name, arguments} JSON per line.
// This is not Codex's native MCP tool binding; use only when that binding is unavailable.
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  stderr: 'pipe',
});
let diagnostic = '';
transport.stderr.on('data', data => { diagnostic += data.toString(); });
const client = new Client({ name: 'current-chat-mkb-client', version: '0.1.0' });
try {
  await client.connect(transport);
  console.log(JSON.stringify({ ready: true, tools: (await client.listTools()).tools.map(tool => tool.name) }));
  const input = createInterface({ input: process.stdin, terminal: false });
  for await (const line of input) {
    try {
      const command = JSON.parse(line);
      if (command.name === 'close_client') break;
      if (command.name === 'pairing_setup') {
        const status = JSON.parse((await client.callTool({ name: 'connection_status', arguments: {include_pairing_code:true} })).content[0].text);
        console.log(JSON.stringify(status.error ? {error:status.error} :
          { origin: status.origin, token: status.pairingToken, pairingCode:status.pairingCode }));
      } else console.log(JSON.stringify(await client.callTool(command)));
    } catch (error) { console.log(JSON.stringify({ error: error.message })); }
  }
} catch (error) {
  console.error(error.message);
  console.error(diagnostic.replace(/Pairing token: [a-f0-9]+/g, 'Pairing token: [redacted]'));
  process.exitCode = 1;
} finally {
  await client.close();
  process.stdin.pause();
}
