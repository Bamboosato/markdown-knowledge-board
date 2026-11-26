import {spawn} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const profileName = /^(?:Default|Profile [1-9][0-9]{0,3})$/;
const keyPattern = /^[a-f0-9]{64}$/;
function valid(target) {
  return target && ['chrome','edge'].includes(target.browser) && typeof target.profile === 'string' &&
    profileName.test(target.profile) && typeof target.key === 'string' && keyPattern.test(target.key) && typeof target.paused === 'boolean';
}

// Never accept a browser executable, arbitrary command line or URL from the PWA.
export function windowsLaunchTarget(target,local=process.env.LOCALAPPDATA) {
  if (process.platform !== 'win32' || !valid(target)) throw Error('AUTO_LAUNCH_FAILED');
  const edge = target.browser === 'edge';
  const vendor = edge ? 'Microsoft' : 'Google';
  const product = edge ? 'Edge' : 'Chrome';
  if (!local) throw Error('AUTO_LAUNCH_FAILED');
  const profile = join(local,vendor,product,'User Data',target.profile,'Preferences');
  // Some STDIO clients inherit ProgramFiles but omit ProgramFiles(x86), where Edge is commonly installed.
  const programs=process.env.ProgramFiles;
  const programs86=process.env['ProgramFiles(x86)'] ?? (programs && join(dirname(programs),'Program Files (x86)'));
  const exe = [programs,programs86,local].filter(Boolean)
    .map(base=>join(base,vendor,product,'Application',edge?'msedge.exe':'chrome.exe')).find(existsSync);
  if (!exe || !existsSync(profile)) throw Error('AUTO_LAUNCH_FAILED');
  return {exe,args:['--profile-directory='+target.profile,'--app='+target.origin+'/?mkb-connect=1']};
}

export async function openWindowsProfile(target) {
  const {exe,args}=windowsLaunchTarget(target);
  const child = spawn(exe,args,
    {detached:true,stdio:'ignore',windowsHide:true,shell:false});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();
}

// One broker serializes registration, pause and wake across all MCP clients.
export function autoOpen({directory,origins,launch=openWindowsProfile,timeout=18000,grace=5200}) {
  const path = join(directory,'auto-open.json');
  let target = null, pending;
  try {
    target = JSON.parse(readFileSync(path,'utf8'));
    if (!valid(target) || !origins.includes(target.origin)) throw Error('Invalid auto-open registration');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  function set(value) {
    if (value) {
      const temp = path+'.'+randomUUID()+'.tmp';
      try {writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temp,path);}
      finally {rmSync(temp,{force:true});}
    } else rmSync(path,{force:true});
    target = value;
  }
  const matches = (origin,key)=>Boolean(target && target.origin===origin && target.key===key);
  return {
    get state(){return !target?'off':target.paused?'paused':'enabled';},
    accept(origin,key){return !target || matches(origin,key) && !target.paused;},
    configure(origin,body) {
      if (!origins.includes(origin) || (target && !matches(origin,body.key))) throw Error('AUTO_PROFILE_MISMATCH');
      if (body.action==='enable') {
        const next={origin,key:body.key,browser:body.browser,profile:body.profile,paused:false};
        if (!valid(next)) throw Error('AUTO_INVALID_PROFILE');
        set(next);
      } else if (!target) throw Error('AUTO_NOT_CONFIGURED');
      else if (body.action==='forget') set(null);
      else if (['pause','resume'].includes(body.action)) set({...target,paused:body.action==='pause'});
      else throw Error('AUTO_INVALID_ACTION');
    },
    async ready(probe) {
      if (!target) return probe().connected ? null : 'NOT_CONNECTED';
      if (target.paused) return 'AUTO_PAUSED';
      if (pending) return pending;
      const expected=target;
      const start=Date.now(), initial=probe();
      pending=(async()=>{
        let launched=false;
        while (Date.now()-start < timeout) {
          if (target!==expected) return 'AUTO_REGISTRATION_CHANGED';
          const live=probe();
          if (live.connected && matches(live.origin,live.key) && live.poll>initial.poll) return null;
          if (!launched && (!initial.connected || Date.now()-start>=grace)) {
            launched=true;
            try {await launch(expected);} catch {return 'AUTO_LAUNCH_FAILED';}
          }
          await delay(100);
        }
        return 'AUTO_CONNECT_TIMEOUT';
      })().finally(()=>{pending=undefined;});
      return pending;
    }
  };
}
