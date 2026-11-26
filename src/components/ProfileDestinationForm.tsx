import {useEffect,useRef,useState,type ReactNode} from 'react';
import {LOCAL_MCP_CONNECTION_KEY, type LocalMcpConnection} from '../lib/localMcpConnection';
import {LocalMcpRequestError, request} from '../lib/localMcpRequest';
import {currentBrowser,destinationLabel,type ProfileOptions} from '../lib/localMcpProfileProof';

type Props={
  credentials:()=>LocalMcpConnection;
  credentialsFields:ReactNode;
  missingCredentials:boolean;
  noteAccess:boolean;
  onCancel:()=>void;
  onRegistered:(value:LocalMcpConnection)=>Promise<void>;
};

export function ProfileDestinationForm({credentials,credentialsFields,missingCredentials,noteAccess,onCancel,onRegistered}:Props) {
  const browser=currentBrowser();
  const [options,setOptions]=useState<ProfileOptions|null>(null);
  const [profile,setProfile]=useState('');
  const [phase,setPhase]=useState<'idle'|'loading'|'checking'|'saving'>('idle');
  const [error,setError]=useState('');
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);

  async function submit() {
    if (pending.current) return;
    const controller=new AbortController();
    pending.current=controller;
    let channel:BroadcastChannel|undefined;
    setError('');
    try {
      const {origin,token}=credentials();
      const active={origin,token,clientId:crypto.randomUUID()};
      if (!options) {
        setPhase('loading');
        const info:ProfileOptions=await request(active,'destination',{action:'options',browser},AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));
        if (!info.profiles?.length) throw Error('No profiles found in the standard Windows user data folder for this browser.');
        setOptions(info);setProfile(info.profiles.length===1 ? info.profiles[0] : '');
        return;
      }
      setPhase('checking');
      const key=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
      channel=new BroadcastChannel('mkb-profile-'+active.clientId);
      const proof=new Promise<string>((resolve,reject)=>{
        channel!.onmessage=event=>{if (typeof event.data==='string') resolve(event.data);};
        signal.addEventListener('abort',()=>reject(Error('Could not verify this profile. Choose the profile where you opened MKB and try again.')),{once:true});
      });
      const [,answer]=await Promise.all([
        request(active,'destination',{action:'verify',revision:options.revision,browser,profile,key},signal),proof,
      ]);
      signal.throwIfAborted();
      setPhase('saving');
      const value={origin,token,noteAccess,auto:{browser,profile,key,paused:false}};
      // Persist the proof of ownership before committing so a lost HTTP reply is recoverable.
      const previous=localStorage.getItem(LOCAL_MCP_CONNECTION_KEY);
      const staged=JSON.stringify(value);
      localStorage.setItem(LOCAL_MCP_CONNECTION_KEY,staged);
      try {
        await request(active,'destination',{action:'commit',proof:answer});
      } catch (cause) {
        if (!(cause instanceof LocalMcpRequestError)) throw Error('Registration could not be confirmed. Reload MKB to check the current destination.');
        if (localStorage.getItem(LOCAL_MCP_CONNECTION_KEY)===staged) {
          if (previous===null) localStorage.removeItem(LOCAL_MCP_CONNECTION_KEY);
          else localStorage.setItem(LOCAL_MCP_CONNECTION_KEY,previous);
        }
        throw cause;
      }
      await onRegistered(value);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message=cause instanceof Error ? cause.message : 'Could not register this profile.';
        setError(/Connect this tab first|Unknown operation/.test(message)?'Update the local Windows MCP runtime and restart your MCP client.':message);
        setOptions(null);
      }
    } finally {
      controller.abort();channel?.close();pending.current=null;setPhase('idle');
    }
  }
  return <form onSubmit={event=>{event.preventDefault();void submit();}}>
    {!options && credentialsFields}
    <p>Browser: {browser==='edge'?'Edge':'Chrome'}</p>
    {options && <>
      {options.destination && <p>Current destination: {options.destination.origin} · {destinationLabel(options.destination)}</p>}
      <label>Profile directory <select value={profile} disabled={phase!=='idle'} onChange={event=>setProfile(event.target.value)}>
        {!profile && <option value="">Select this window’s profile</option>}
        {options.profiles.map(name=><option key={name}>{name}</option>)}
      </select></label>
      {options.profiles.length>1 && <small>Check Profile Path at {browser==='edge'?'edge://version':'chrome://version'} to identify this window’s profile.</small>}
      {options.destination && profile && <p>New destination: {location.origin} · {destinationLabel({browser,profile})}</p>}
    </>}
    {phase==='checking' && <p role="status">Checking the selected browser profile…</p>}
    {error && <p role="alert">{error}</p>}
    <button className="local-mcp-primary" type="submit" disabled={phase!=='idle' || (options ? !profile : missingCredentials)}>
      {options ? options.destination ? 'Change save destination' : 'Register save destination' : 'Find profiles'}
    </button>
    <button type="button" disabled={phase==='saving'} onClick={()=>{pending.current?.abort();onCancel();}}>Cancel</button>
  </form>;
}
