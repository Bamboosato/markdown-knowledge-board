// Actual STDIO, shared HTTP broker, built PWA and persistent *test* profiles.
// Only the OS browser selection is substituted to keep the user's profile untouched.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {loadIdentity} from './identity.mjs';
import {startBroker} from './broker.mjs';
import {autoOpen,windowsLaunchTarget} from './auto-open.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const work=await mkdtemp(join(tmpdir(),'mkb-auto-test-'));
const app=await preview({root,preview:{host:'127.0.0.1',port:0,open:false},logLevel:'error'});
const origin='http://127.0.0.1:'+app.httpServer.address().port;
const free=createServer().listen(0,'127.0.0.1');
await once(free,'listening');
const identity=await loadIdentity({directory:work,seed:{port:free.address().port}});
await new Promise(resolve=>free.close(resolve));
const client=new Client({name:'mkb-auto-test',version:'1'});
let browser,page,broker,nativeBrowser,nativeChild,launches=0,mode='registered';
const edge=process.argv.includes('--native-edge');
const native=edge || process.argv.includes('--native-chrome');
// Keep Playwright's environment intact when setting up the test profile.
const profileRoot=name=>join(work,name,edge?'Microsoft':'Google',edge?'Edge':'Chrome','User Data');
async function closeBrowser() {
  if (nativeBrowser) {
    const stopped=once(nativeChild,'exit');
    const cdp=await nativeBrowser.newBrowserCDPSession();
    await cdp.send('Browser.close').catch(()=>{});
    await stopped;
    nativeChild=undefined;nativeBrowser=undefined;
  } else await browser?.close();
  browser=undefined;
}
async function openProfile(name) {
  browser=await chromium.launchPersistentContext(profileRoot(name),{headless:true,channel:edge?'msedge':native?'chrome':undefined,serviceWorkers:'block'});
  page=browser.pages()[0];
  await page.goto(origin,{waitUntil:'domcontentloaded'});
}
async function launch(target) {
  ++launches;
  assert.equal(target.origin,origin);
  assert.equal(target.browser,edge?'edge':'chrome');
  assert.equal(target.profile,'Default');
  if (!native || mode==='wrong') {
    if (mode==='missing') throw Error('Missing browser');
    return openProfile(mode==='wrong'?'other':'registered');
  }
  const local=join(work,mode==='missing'?'absent':'registered');
  const savedProgramFiles=process.env['ProgramFiles(x86)'];
  let command;
  try {
    if (edge) delete process.env['ProgramFiles(x86)']; // Match the MCP SDK's Windows environment.
    command=windowsLaunchTarget(target,local);
  } finally {
    if (savedProgramFiles) process.env['ProgramFiles(x86)']=savedProgramFiles;
  }
  const {exe,args}=command;
  const root=profileRoot('registered');
  // Only this test adds headless mode, an isolated data directory and a private
  // loopback debugging port so it can inspect and close its own browser.
  await rm(join(root,'DevToolsActivePort'),{force:true});
  nativeChild=spawn(exe,[...args,'--headless=new','--user-data-dir='+root,'--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1','--disable-background-networking','--no-first-run'],{stdio:'ignore',windowsHide:true});
  await once(nativeChild,'spawn');
  const deadline=Date.now()+9000;
  while (Date.now()<deadline) {
    try {
      const [port,endpoint]=(await readFile(join(root,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);
      if (!/^\d+$/.test(port) || !/^\/devtools\/browser\/[\w-]+$/.test(endpoint)) continue;
      nativeBrowser=await chromium.connectOverCDP('ws://127.0.0.1:'+port+endpoint,{timeout:1000});
      break;
    } catch {await new Promise(resolve=>setTimeout(resolve,120));}
  }
  if (!nativeBrowser) throw Error('Isolated browser did not start');
  browser=nativeBrowser.contexts()[0];
  // Edge can open a separate startup tab. Find the destination across all tabs
  // even if CDP attaches before its first navigation.
  const navigationDeadline=Date.now()+7000;
  while (Date.now()<navigationDeadline) {
    page=browser.pages().find(candidate=>candidate.url().startsWith(origin+'/'));
    if (page) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Destination tab did not navigate');

}
async function start() {
  const checkedLaunch=async target=>{
    try {await launch(target);} catch(error) {
      if(mode!=='missing') console.error('Isolated launch failed',error.name,String(error.message).split('\n')[0],{launches,tabs:browser?.pages().length});
      throw error;
    }
  };
  broker=startBroker(identity,[origin],autoOpen({directory:work,origins:[origin],launch:checkedLaunch,timeout:12500}));
  await once(broker.http,'listening');
}
async function stop() {
  const closed=once(broker.http,'close');
  broker.stop();
  await closed;
}
async function call(name,args={}) {
  const result=await client.callTool({name,arguments:args});
  return JSON.parse(result.content[0].text);
}
async function panel() {
  await page.getByRole('button',{name:'Open application menu'}).click();
  await page.getByRole('menuitem',{name:'Local MCP',exact:true}).click();
}
async function stored(id) {
  return page.evaluate(id=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('markdown-knowledge-board');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;
      const get=db.transaction('notes').objectStore('notes').get(id);
      get.onsuccess=()=>{db.close();resolve(get.result?.body ?? null);};
      get.onerror=()=>{db.close();reject(get.error);};
    };
  }),id);
}
const note={request_id:'auto-open-fixture-01',title:'Auto open fixture',markdown:'Only the registered test profile.',tags:[]};
try {
  await start();
  await client.connect(new StdioClientTransport({command:process.execPath,args:[join(root,'tools/local-mcp/server.mjs')],
    cwd:root,stderr:'pipe',env:{MKB_MCP_STATE_DIR:work,MKB_MCP_DEV:'0'}}));
  const setup=await call('connection_status');
  assert.equal(setup.connected,false);
  assert.equal(launches,0);
  await openProfile('registered');
  await panel();
  const setUp = page.getByRole('button', {name:'Set up automatic connection'});
  const register = page.getByRole('button', {name:'Register save destination'});
  await page.locator('summary').filter({hasText:'Manual connection'}).waitFor();
  await setUp.click();
  await page.getByLabel('Connection code', {exact:true}).fill(setup.pairingCode);
  await register.click();
  await page.getByText('Enabled', {exact:true}).waitFor();
  assert.equal(await page.locator('summary').filter({hasText:'Manual connection'}).count(), 0);
  assert.equal((await call('connection_status')).automatic,'enabled');

  // A profile paired before automatic opening can enroll while disconnected.
  await page.getByRole('button',{name:'Advanced settings'}).click();
  await page.getByRole('button',{name:'Forget connection'}).click();
  await setUp.waitFor();
  await page.locator('summary').filter({hasText:'Manual connection'}).click();
  await page.getByLabel('Connection code', {exact:true}).fill(setup.pairingCode);
  await page.getByLabel('Remember in this browser').check();
  await page.getByRole('button',{name:'Connect local MCP',exact:true}).click();
  await page.locator('#local-mcp-panel').waitFor({state:'hidden'});
  await closeBrowser();
  await openProfile('registered');
  await panel();
  assert.equal((await call('connection_status')).automatic,'off');
  await page.getByRole('button',{name:'Set up automatic connection'}).click();
  assert.equal(await page.getByLabel('Connection code',{exact:true}).isVisible(),false);
  await page.getByRole('button',{name:'Register save destination'}).click();
  await page.getByText('Enabled',{exact:true}).waitFor();
  assert.equal((await call('connection_status')).automatic,'enabled');
  await closeBrowser();
  await stop();
  await start();
  assert.equal((await call('connection_status')).connected,false);
  assert.equal(launches,0);

  const [saved,ready]=await Promise.all([call('create_note',note),call('ensure_connection')]);
  assert.equal(saved.status,'saved',JSON.stringify(saved.error));
  assert.equal(ready.browserOrigin,origin);
  assert.equal(launches,1);
  assert.equal(await stored(saved.id),note.markdown);
  const replay=await call('create_note',note);
  assert.equal(replay.id,saved.id);
  assert.equal(replay.reused,true);
  assert.equal(launches,1);
  console.log('PASS: closed app and restarted broker, one launch for concurrent requests, saved body and replay.');
  await closeBrowser();
  const reopened=await call('ensure_connection');
  assert.equal(reopened.browserOrigin,origin,JSON.stringify(reopened.error));
  assert.equal(launches,2);
  assert.equal(await stored(saved.id),note.markdown);
  console.log('PASS: closing a recently connected app with the broker still running reopens the same profile.');

  await panel();
  await page.getByRole('button',{name:'Pause automatic connection'}).click();
  await page.getByRole('button',{name:'Resume automatic connection',exact:true}).waitFor();
  await page.getByText('Connection: Disconnected',{exact:true}).waitFor();
  assert.equal(await page.locator('summary').filter({hasText:'Manual connection'}).count(), 0);
  assert.equal((await call('create_note',note)).error,'AUTO_PAUSED');
  assert.equal(launches,2);
  await page.getByRole('button',{name:'Resume automatic connection',exact:true}).click();
  await page.getByText('Enabled',{exact:true}).waitFor();
  assert.equal((await call('ensure_connection')).connected,true);
  await page.getByText('Connection: Connected',{exact:true}).waitFor();
  assert.equal(await page.locator('summary').filter({hasText:'Manual connection'}).count(), 0);
  await closeBrowser();
  await stop();
  await start();
  mode='missing';
  assert.equal((await call('create_note',note)).error,'AUTO_LAUNCH_FAILED');
  mode='wrong';
  const unsaved={...note,request_id:'auto-open-wrong-profile'};
  const blocked=call('create_note',unsaved);
  const deadline=Date.now()+10000;
  while (!page || page.isClosed()) {
    if (Date.now()>=deadline) throw Error('Second profile did not open');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  await panel();
  await page.locator('summary').filter({hasText:'Manual connection'}).click();
  await page.getByLabel('Connection code',{exact:true}).fill(setup.pairingCode);
  await page.getByRole('button',{name:'Connect local MCP',exact:true}).click();
  await page.getByRole('status').filter({hasText:'registered profile'}).waitFor();
  assert.equal((await blocked).error,'AUTO_CONNECT_TIMEOUT');
  const wrongId='mcp-'+createHash('sha256').update(unsaved.request_id).digest('hex');
  assert.equal(await stored(wrongId),null);
  assert.equal((await call('connection_status')).connected,false);
  console.log('PASS: explicit pause, manual resume, launch failure and second profile rejection.');
} finally {
  await client.close();
  await closeBrowser();
  if (nativeChild && nativeChild.exitCode===null) nativeChild.kill();
  if (broker?.http.listening) await stop();
  await new Promise(resolve=>app.httpServer.close(resolve));
  if (!resolve(work).startsWith(resolve(tmpdir())+sep+'mkb-auto-test-')) throw Error('Unexpected temporary directory');
  await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
