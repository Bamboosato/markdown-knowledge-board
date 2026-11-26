import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveLocalMcpNote } from '../lib/localMcpNote';
import { executeNoteAccess } from '../lib/localMcpAccess';
import { createMetadataSession } from '../lib/localMcpMetadata';
import { NoteAccessError } from '../lib/noteRevision';
import { LOCAL_MCP_CONNECTION_KEY, parseLocalMcpCode, readLocalMcpConnection, validateLocalMcpConnection } from '../lib/localMcpConnection';
import type { LocalMcpConnection } from '../lib/localMcpConnection';
import './LocalMcpPanel.css';

import { LocalMcpRequestError, request, type Session } from '../lib/localMcpRequest';
import { ProfileDestinationForm } from './ProfileDestinationForm';
import { currentBrowser, destinationLabel, type ProfileOptions } from '../lib/localMcpProfileProof';
const metadataOperations = ['preview_custom_metadata_changes', 'apply_custom_metadata_changes'];
const supportedMetadataActions = ['add', 'update', 'upsert', 'remove'];
const brokerActions = (value: unknown): string[] => Array.isArray(value) ? supportedMetadataActions.filter(action => value.includes(action)) : [];
const supportedOperations = ['create_note', 'search_notes', 'get_note', 'update_note', 'append_note', 'replace_note_text', ...metadataOperations];

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function LocalMcpPanel({ open, onClose }: Props) {
  const [address, setAddress] = useState(import.meta.env.DEV && import.meta.env.MODE === 'local-mcp' ? location.origin : '');
  const addressRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [savedConnection, setSavedConnection] = useState(readLocalMcpConnection);
  const [noteAccess, setNoteAccess] = useState(() => readLocalMcpConnection()?.noteAccess === true);
  const noteAccessRef = useRef(noteAccess);
  const metadataSessionRef = useRef<ReturnType<typeof createMetadataSession> | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [remember, setRemember] = useState(Boolean(savedConnection));
  const [setupAuto, setSetupAuto] = useState(false);
  const attemptedAuto=useRef(false);
  const [otherDestination,setOtherDestination]=useState('');
  const [manual, setManual] = useState(false);
  const [storageWarning, setStorageWarning] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (showSetup) (manual ? addressRef : codeRef).current?.focus();
  }, [showSetup, manual]);

  useEffect(() => {
    if (!session) return;
    const metadataSession = createMetadataSession();
    metadataSessionRef.current = metadataSession;
    const controller = new AbortController();
    let stopped = false;
    let actions = session.brokerMetadataActions ?? [];
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { job, brokerMetadataActions } = await request(session, 'poll', { protocolVersion: 2, supportedOperations, supportedMetadataActions, noteAccess: noteAccessRef.current }, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
        if (stopped) return;
        actions = brokerActions(brokerMetadataActions);
        if (job) {
          let receipt;
          try {
            if (job.operation && job.operation !== 'create_note') {
              receipt = metadataOperations.includes(job.operation)
                ? await metadataSession.execute(job.operation, job.input, () => !stopped && noteAccessRef.current, () => actions.includes('remove'))
                : await executeNoteAccess(job.operation, job.input, () => !stopped && noteAccessRef.current);
              if (!stopped && ['update_note', 'append_note', 'replace_note_text', 'apply_custom_metadata_changes'].includes(job.operation)) setStatus('Note update completed.');
            } else {
            const saved = await saveLocalMcpNote(job.input);
            window.dispatchEvent(new CustomEvent('local-mcp-note-saved', { detail: saved.note }));
            receipt = { id: saved.note.id, title: saved.note.title, reused: saved.reused };
            if (!stopped) setStatus(`${saved.reused ? 'Already saved' : 'Saved'}: ${saved.note.title}`);
            }
          } catch (error) {
            // Runtime 0.6 brokers accept UNSUPPORTED_OPERATION, but not UPGRADE_REQUIRED in ACKs.
            // New runtimes translate this metadata-only refusal into the public upgrade error.
            const code = error instanceof NoteAccessError ? error.code : 'SAVE_FAILED';
            receipt = !job.operation || job.operation === 'create_note' ? { error: 'SAVE_FAILED' } : {
              error: { code: code === 'UPGRADE_REQUIRED' && metadataOperations.includes(job.operation) ? 'UNSUPPORTED_OPERATION' : code,
                message: error instanceof NoteAccessError ? error.message : 'MKB could not complete this operation.' },
            };
            if (!stopped) setStatus(error instanceof Error ? error.message : 'Save failed.');
          }
          if (stopped) return;
          await request(session, 'ack', { deliveryId: job.deliveryId, result: receipt }, controller.signal);
        }
        if (!stopped) timer = setTimeout(() => void poll(), 400);
      } catch {
        if (!stopped) {
          setStatus('Connection lost. A pending save may have completed; retry with the same request_id.');
          setConnectionError(true);
          setSession(null);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      metadataSession.close();
      if (metadataSessionRef.current === metadataSession) metadataSessionRef.current = null;
      clearTimeout(timer);
      controller.abort();
      void request(session, 'disconnect').catch(() => {});
    };
  }, [session]);

  function rememberConnection(value:LocalMcpConnection) {
    localStorage.setItem(LOCAL_MCP_CONNECTION_KEY,JSON.stringify(value));
    setSavedConnection(value);
  }

  // Reconcile a registration changed by another profile, including while paused.
  useEffect(()=>{
    if (!open || !savedConnection || connecting || setupAuto) return;
    let active=true;
    const saved=savedConnection;
    const refresh=()=>request({...saved,clientId:crypto.randomUUID()},'destination',
      {action:'options',browser:currentBrowser(),key:saved.auto?.key}).then((info:ProfileOptions)=>{
      if (!active || !Array.isArray(info.profiles)) return;
      setOtherDestination(!info.owner && info.destination ? destinationLabel(info.destination) : '');
      if (!saved.auto || readLocalMcpConnection()?.auto?.key!==saved.auto.key) return;
      if (!info.owner) {
        rememberConnection({origin:saved.origin,token:saved.token,noteAccess:saved.noteAccess});
        setStatus('The save destination was changed.');setConnectionError(false);
      } else if (info.destination && info.destination.paused!==saved.auto.paused) {
        rememberConnection({...saved,auto:{...saved.auto,paused:info.destination.paused}});
      }
    }).catch(()=>{});
    void refresh();
    window.addEventListener('focus',refresh);
    return ()=>{active=false;window.removeEventListener('focus',refresh);};
  },[open,savedConnection,session,connecting,setupAuto]);

  async function disconnect() {
    if (savedConnection?.auto) {
      const saved={...savedConnection,auto:{...savedConnection.auto,paused:true}};
      try {
        rememberConnection(saved);
        await request(session ?? { ...savedConnection, clientId: crypto.randomUUID() },'auto',{action:'pause',key:saved.auto.key});
      } catch {setStorageWarning('Pause could not be confirmed. Start your MCP client, then resume and try again.');}
    }
    setSession(null);setConnectionError(false);setStatus('Disconnected.');
  }

  async function forgetConnection() {
    if (savedConnection?.auto) {
      const active=session ?? {...savedConnection,clientId:crypto.randomUUID()};
      try {await request(active,'auto',{action:'forget',key:savedConnection.auto.key});}
      catch {setStorageWarning('Start the local broker and try Forget again.');return;}
      setSession(null);
    }
    try {
      localStorage.removeItem(LOCAL_MCP_CONNECTION_KEY);
      noteAccessRef.current = false;
      metadataSessionRef.current?.clear();
      setNoteAccess(false);
      if (session) void request(session, 'permissions', { noteAccess: false }).catch(() => {});
      setSavedConnection(null);
      setShowSetup(false);
      setSetupAuto(false);
      setRemember(false);
      setStorageWarning('');
    } catch {
      setStorageWarning('Could not forget this connection. Check browser site settings.');
    }
  }

  async function connect(saved?: LocalMcpConnection, automatic=false) {
    if (connecting) return;
    setConnecting(true);
    setConnectionError(false);
    setStatus('');
    try {
      const credentials = saved ? validateLocalMcpConnection(saved.origin, saved.token)
        : manual ? validateLocalMcpConnection(address, token) : parseLocalMcpCode(code);
      const next = { ...credentials, clientId: crypto.randomUUID() };
      const stored = readLocalMcpConnection();
      const allowed = stored?.origin === next.origin && stored?.token === next.token && stored.noteAccess === true;
      noteAccessRef.current = allowed;
      setNoteAccess(allowed);
      const bound=stored?.origin===next.origin && stored?.token===next.token ? stored.auto : undefined;
      if (bound?.paused && automatic) return;
      if (bound && !automatic) await request(next,'auto',{action:'resume',key:bound.key});
      const openSession = () => request(next, 'connect', {
        protocolVersion: 2, supportedOperations, supportedMetadataActions, noteAccess: allowed, profileKey: bound?.key,
      }, AbortSignal.timeout(60000));
      const connected = await openSession().catch(async error => {
        if (!automatic || !(error instanceof LocalMcpRequestError) || error.status !== 409) throw error;
        // A recently closed tab keeps its broker lease for up to five seconds.
        await new Promise(resolve => setTimeout(resolve, 5100));
        if (!mountedRef.current) throw error;
        const current = readLocalMcpConnection();
        if (!current?.auto || current.auto.paused || current.auto.key !== bound?.key ||
            current.origin !== next.origin || current.token !== next.token) return;
        return openSession();
      });
      if (!connected) return;
      if (!mountedRef.current) {
        await request(next, 'disconnect').catch(() => {});
        return;
      }
      setSession({ ...next, brokerMetadataActions: brokerActions(connected.brokerMetadataActions) });
      setToken('');
      setCode('');
      let remembered = true;
      try {
        if (saved || remember) {
          const rememberedConnection = { ...credentials, noteAccess: allowed, ...(bound && {auto:{...bound,paused:false}}) };
          localStorage.setItem(LOCAL_MCP_CONNECTION_KEY, JSON.stringify(rememberedConnection));
          setSavedConnection(rememberedConnection);
          setShowSetup(false);
        } else {
          localStorage.removeItem(LOCAL_MCP_CONNECTION_KEY);
          setSavedConnection(null);
        }
        setStorageWarning('');
      } catch {
        remembered = false;
        setStorageWarning('Connected, but could not remember settings. Keep your connection code.');
      }
      setStatus('Ready to receive notes.');
      setAdvancedOpen(false);
      setSetupAuto(false);
      if (remembered && !automatic && !bound) onClose();
    } catch (error) {
      if (automatic) {
        const anotherTab = error instanceof LocalMcpRequestError && error.status === 409;
        setConnectionError(!anotherTab);
        if (anotherTab) {
          setStatus('Another MKB tab was connected. To use this tab, close the other one and reload this page.');
        } else if (error instanceof LocalMcpRequestError) {
          setStatus(error.message);
        } else {
          setStatus('Could not reach the local MCP service. Check that your MCP client is running and the browser allows local connections, then reload MKB.');
        }
        return;
      }
      setConnectionError(true);
      if (saved && !saved.auto) { setSetupAuto(false); setShowSetup(true); setAdvancedOpen(true); }
      setStatus(saved ? 'Reconnect failed. Start your MCP client and close other connected tabs, then retry.'
        : error instanceof TypeError ? 'Cannot connect. Check your MCP client and browser permissions.' : error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  }

  useEffect(()=>{
    const saved=readLocalMcpConnection();
    if (attemptedAuto.current || !saved?.auto || saved.auto.paused) return;
    attemptedAuto.current=true;
    void connect(saved,true);
    // Bootstrap once per mount; user actions control subsequent connections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function changeNoteAccess(allowed: boolean) {
    if (!allowed) metadataSessionRef.current?.clear();
    noteAccessRef.current = allowed;
    setNoteAccess(allowed);
    try {
      if (savedConnection) {
        const next = { ...savedConnection, noteAccess: allowed };
        localStorage.setItem(LOCAL_MCP_CONNECTION_KEY, JSON.stringify(next));
        setSavedConnection(next);
      }
      setStorageWarning('');
    } catch { setStorageWarning('Could not remember access settings.'); }
    if (session) void request(session, 'permissions', { noteAccess: allowed }).catch(() => {});
  }

  const auto = savedConnection?.auto;
  const needsCredentials = !session && !savedConnection;
  const missingCredentials = manual ? !token.trim() || !address.trim() : !code.trim();
  const connectionState = session ? 'Connected' : connecting ? 'Connecting…' : connectionError ? 'Connection error' : 'Disconnected';
  const credentialsFields = <>
        {!manual && <>
          <label htmlFor="local-mcp-code">Connection code</label>
          <input ref={codeRef} id="local-mcp-code" type="password" autoComplete="off" placeholder="Paste connection code"
            value={code} onChange={event => setCode(event.target.value)} disabled={connecting} />
        </>}
        {manual && <>
        <label htmlFor="local-mcp-address">Server address</label>
        <input ref={addressRef} id="local-mcp-address" type="url" placeholder="http://127.0.0.1:port"
          autoComplete="off" value={address} onChange={event => setAddress(event.target.value)} disabled={connecting} />
        <label htmlFor="local-mcp-token">Pairing token</label>
        <input id="local-mcp-token" type="password" autoComplete="off" value={token}
          onChange={event => setToken(event.target.value)} disabled={connecting} />
        </>}
  </>;
  const manualForm = <form onSubmit={event => { event.preventDefault(); void connect(); }}>
    {credentialsFields}
    <label className="local-mcp-remember"><input type="checkbox" checked={remember}
      onChange={event => setRemember(event.target.checked)} />Remember in this browser</label>
    <button type="submit" disabled={connecting || missingCredentials}>Connect local MCP</button>
  </form>;

  // Keep polling even when the settings panel is closed.
  return createPortal(<aside id="local-mcp-panel" hidden={!open} className="local-mcp-panel" aria-label="Local MCP" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <div className="local-mcp-heading">
      <h2>Local MCP</h2>
      <button ref={closeRef} type="button" onClick={onClose}>Close</button>
    </div>
    <section aria-labelledby="local-mcp-auto-heading">
      <div className="local-mcp-heading">
        <h3 id="local-mcp-auto-heading">Automatic connection for saves</h3>
        <span>{auto ? auto.paused ? 'Paused' : 'Enabled' : 'Not set up'}</span>
      </div>
      <p className="local-mcp-destination">Save to: {location.origin}{auto && ` · ${auto.browser === 'edge' ? 'Edge' : 'Chrome'} / ${auto.profile}`}</p>
      {auto && <p>This profile is the save destination.</p>}
      {auto && <p>Connection: {connectionState}</p>}
      {setupAuto && open ? <ProfileDestinationForm credentials={() => session ?? savedConnection ?? (manual ? validateLocalMcpConnection(address,token) : parseLocalMcpCode(code))}
        credentialsFields={needsCredentials ? credentialsFields : null} missingCredentials={needsCredentials && missingCredentials}
        noteAccess={noteAccess} onCancel={()=>setSetupAuto(false)}
        onRegistered={async value=>{
          rememberConnection(value);
          setOtherDestination('');setSetupAuto(false);setCode('');setToken('');setSession(null);
          await connect(value,true);
        }} /> : auto && savedConnection ? <button type="button" disabled={connecting} onClick={() => auto.paused ? void connect(savedConnection) : void disconnect()}>
        {auto.paused ? 'Resume automatic connection' : 'Pause automatic connection'}
      </button> : <>
        {otherDestination && <p>Current destination: {otherDestination}</p>}
        <button className="local-mcp-primary" type="button" disabled={connecting} onClick={() => {
          setSetupAuto(true);setShowSetup(false);setStorageWarning('');
        }}>Use this profile for saves</button>
      </>}
    </section>
    {!auto && <details>
      <summary>Manual connection <span>{connectionState}</span></summary>
      {session ? <button type="button" disabled={connecting} onClick={() => void disconnect()}>
        Disconnect local MCP
      </button> : savedConnection ? <button type="button" disabled={connecting} onClick={() => void connect(savedConnection)}>
        Reconnect
      </button> : !setupAuto && manualForm}
    </details>}
    <details>
      <summary>Note access</summary>
      <label className="local-mcp-remember"><input type="checkbox" checked={noteAccess} disabled={connecting || (!session && !savedConnection)}
        onChange={event => changeNoteAccess(event.target.checked)} />Allow reading and updating notes</label>
      <small>Optional for saving new notes.</small>
    </details>
    <div className="local-mcp-advanced">
      <button type="button" className="local-mcp-disclosure" aria-expanded={advancedOpen} aria-controls="local-mcp-advanced-content"
        onClick={() => { setAdvancedOpen(!advancedOpen); setShowSetup(false); }}>
        Advanced settings
      </button>
      <div id="local-mcp-advanced-content" hidden={!advancedOpen}>
        {(savedConnection || session) && <p>Server: {savedConnection?.origin ?? session?.origin}</p>}
        {!auto && !session && <label className="local-mcp-remember"><input type="checkbox" checked={manual}
          onChange={event => setManual(event.target.checked)} />Enter address and token</label>}
        <div className="local-mcp-settings-actions">
          {!auto && !session && savedConnection && <button type="button" disabled={connecting} onClick={() => {
            setShowSetup(!showSetup); setSetupAuto(false);
          }}>{showSetup ? 'Cancel setup' : 'Use a new code'}</button>}
          {savedConnection && <button type="button" disabled={connecting} onClick={() => void forgetConnection()}>Forget connection</button>}
        </div>
        {!auto && !session && savedConnection && showSetup && manualForm}
      </div>
    </div>
    {storageWarning && <p role="alert">{storageWarning}</p>}
    {status && <p role="status">{status}</p>}
  </aside>, document.body);
}
