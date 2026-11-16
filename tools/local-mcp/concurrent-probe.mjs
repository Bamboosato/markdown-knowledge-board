import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const clients=[];
const origins=[];
try {
  for(let n=1;n<=2;n++) {
    const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],stderr:'pipe'});
    let diagnostic=''; transport.stderr.on('data', data=>{diagnostic+=data.toString();});
    const client=new Client({name:`concurrent-probe-${n}`,version:'1'}); clients.push(client);
    try {
      await client.connect(transport);
      const names=(await client.listTools()).tools.map(t=>t.name);
      assert.deepEqual(names.sort(),['connection_status','create_note']);
      const status=JSON.parse((await client.callTool({name:'connection_status',arguments:{}})).content[0].text);
      assert.equal(status.connected,false);
      assert.match(status.pairingToken,/^[a-f0-9]{64}$/);
      origins.push(status.origin);
      console.log(JSON.stringify({client:n,tools:names,origin:status.origin}));
    }
    catch(error) { console.log(JSON.stringify({client:n,error:error.message,diagnostic:diagnostic.replace(/Pairing token: [a-f0-9]+/g,'Pairing token: [redacted]')}));process.exitCode=1; }
  }
  assert.equal(new Set(origins).size,2,'Concurrent clients need separate ports');
} finally { await Promise.allSettled(clients.map(client=>client.close())); }
