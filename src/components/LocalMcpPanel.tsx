import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveLocalMcpNote } from '../lib/localMcpNote';
import { executeNoteAccess } from '../lib/localMcpAccess';
import { createMetadataSession } from '../lib/localMcpMetadata';
import { NoteAccessError } from '../lib/noteRevision';
import { LOCAL_MCP_CONNECTION_KEY, parseLocalMcpCode, readLocalMcpConnection, validateLocalMcpConnection } from '../lib/localMcpConnection';
import type { AutoProfile, LocalMcpConnection } from '../lib/localMcpConnection';
import './LocalMcpPanel.css';

type Session = { token: string; clientId: string; origin: string; brokerMetadataActions?: string[] };
const metadataOperations = ['preview_custom_metadata_changes', 'apply_custom_metadata_changes'];
const supportedMetadataActions = ['add', 'update', 'upsert', 'remove'];
const brokerActions = (value: unknown): string[] => Array.isArray(value) ? supportedMetadataActions.filter(action => value.includes(action)) : [];
const supportedOperations = ['create_note', 'search_notes', 'get_note', 'update_note', 'append_note', 'replace_note_text', ...metadataOperations];

async function request(session: Session, operation: string, value = {}, signal?: AbortSignal) {
  const response = await fetch(`${session.origin}/__local_mcp/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ clientId: session.clientId, ...value }),
    signal: signal ?? AbortSignal.timeout(10000),
    credentials: 'omit', cache: 'no-store', redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Local MCP connection failed.');
  return result;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
  onConnectionChange: (state: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
};

export default function LocalMcpPanel({ open, onClose, onConnected, onConnectionChange }: Props) {
  const [address, setAddress] = useState(import.meta.env.DEV && import.meta.env.MODE === 'local-mcp' ? location.origin : '');
  const addressRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const reconnectRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [savedConnection, setSavedConnection] = useState(readLocalMcpConnection);
  const [noteAccess, setNoteAccess] = useState(() => readLocalMcpConnection()?.noteAccess === true);
  const noteAccessRef = useRef(noteAccess);
  const metadataSessionRef = useRef<ReturnType<typeof createMetadataSession> | null>(null);
  const [showSetup, setShowSetup] = useState(!savedConnection);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [remember, setRemember] = useState(Boolean(savedConnection));
  const [enableOnPair,setEnableOnPair]=useState(false);
  const [browser,setBrowser]=useState<'chrome'|'edge'>(()=>navigator.userAgent.includes('Edg/')?'edge':'chrome');
  const [profile,setProfile]=useState('Default');
  const [autoAvailable,setAutoAvailable]=useState(false);
  const attemptedAuto=useRef(false);
  const enrolling=useRef(false);
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
    if (open) (session ? disconnectRef : manual && showSetup ? addressRef : showSetup ? codeRef : reconnectRef).current?.focus();
  }, [open, session, showSetup, manual, savedConnection]);

  useEffect(() => {
    onConnectionChange(session ? 'connected' : connecting ? 'connecting' : connectionError ? 'error' : 'disconnected');
  }, [session, connecting, connectionError, onConnectionChange]);

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

  async function registerAuto(active:Session,value:LocalMcpConnection) {
    if (!/^(?:Default|Profile [1-9][0-9]{0,3})$/.test(profile)) throw Error('Enter Default or Profile followed by its number.');
    const key=value.auto?.key ?? Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
    const auto:AutoProfile={key,browser,profile,paused:false};
    // Keep the proof locally before sending it, including if the reply is lost.
    if (enrolling.current) return;
    enrolling.current=true;
    try {
      rememberConnection({...value,auto:{...auto,paused:true}});
      await request(active,'auto',{...auto,action:'enable'});
      rememberConnection({...value,auto});
    } finally {enrolling.current=false;}
  }

  async function disconnect() {
    if (savedConnection?.auto) {
      const saved={...savedConnection,auto:{...savedConnection.auto,paused:true}};
      try {
        rememberConnection(saved);
        await request(session!,'auto',{action:'pause',key:saved.auto.key});
      } catch {setStorageWarning('Pause could not be confirmed. Reconnect and try again.');}
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
      setShowSetup(true);
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
      const connected = await request(next, 'connect', { protocolVersion: 2, supportedOperations, supportedMetadataActions, noteAccess: allowed,profileKey:bound?.key }, AbortSignal.timeout(60000));
      setAutoAvailable(connected.autoAvailable===true);
      if (!mountedRef.current) {
        await request(next, 'disconnect').catch(() => {});
        return;
      }
      setSession({ ...next, brokerMetadataActions: brokerActions(connected.brokerMetadataActions) });
      setToken('');
      setCode('');
      let remembered = true;
      try {
        if (remember) {
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
      if (enableOnPair && !bound && remembered && remember) {
        try {
          if (!connected.autoAvailable) throw Error('Update the local Windows MCP runtime to enable automatic opening.');
          await registerAuto(next,{...credentials,noteAccess:allowed});
        } catch (error) {
          setStorageWarning(error instanceof Error?error.message:'Automatic opening could not be confirmed.');
          setAdvancedOpen(true);
          return;
        }
      }
      setStatus('Ready to receive notes.');
      setAdvancedOpen(false);
      if (remembered) onConnected();
    } catch (error) {
      setConnectionError(true);
      if (saved) { setShowSetup(true); setAdvancedOpen(true); }
      setStatus(saved ? 'Reconnect failed. Start Codex and close other connected tabs, then retry.'
        : error instanceof TypeError ? 'Cannot connect. Check Codex and browser permissions.' : error instanceof Error ? error.message : 'Connection failed.');
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

  const profileFields=<>
    <label>Browser <select value={browser} onChange={event=>setBrowser(event.target.value as 'chrome'|'edge')}><option value="chrome">Chrome</option><option value="edge">Edge</option></select></label>
    <label>Profile directory <input value={profile} maxLength={12} onChange={event=>setProfile(event.target.value)} /></label>
    <small>Use the last folder in Profile Path at {browser==='edge'?'edge://version':'chrome://version'}, for example Default or Profile 1.</small>
  </>;
  const setupForm = <form onSubmit={event => { event.preventDefault(); void connect(); }}>
        {!manual && <>
          <label htmlFor="local-mcp-code">Connection code</label>
          <input ref={codeRef} id="local-mcp-code" type="password" autoComplete="off" placeholder="Paste connection code"
            value={code} onChange={event => setCode(event.target.value)} disabled={connecting} />
        </>}
        <button type="button" className="local-mcp-input-toggle" disabled={connecting} aria-expanded={manual}
          onClick={() => setManual(value => !value)}>{manual ? 'Use connection code' : 'Enter address and token'}</button>
        {manual && <>
        <label htmlFor="local-mcp-address">Server address</label>
        <input ref={addressRef} id="local-mcp-address" type="url" placeholder="http://127.0.0.1:port"
          autoComplete="off" value={address} onChange={event => setAddress(event.target.value)} disabled={connecting} />
        <label htmlFor="local-mcp-token">Pairing token</label>
        <input id="local-mcp-token" type="password" autoComplete="off" value={token}
          onChange={event => setToken(event.target.value)} disabled={connecting} />
        </>}
        <label className="local-mcp-remember"><input type="checkbox" checked={remember} disabled={connecting}
          onChange={event => { if (event.target.checked) setRemember(true); else forgetConnection(); }} />
          Remember in this browser</label>
        <small>Use a private device.</small>
        {remember && !savedConnection?.auto && <><label className="local-mcp-remember"><input type="checkbox" checked={enableOnPair} onChange={event=>setEnableOnPair(event.target.checked)} />Open this profile automatically for save requests</label>{enableOnPair && profileFields}</>}
        <button className="local-mcp-primary" type="submit" disabled={connecting || (manual ? !token.trim() || !address.trim() : !code.trim())}>{connecting ? 'Connecting…' : 'Connect local MCP'}</button>
      </form>;

  // Keep this component mounted while hidden: polling and the session outlive the panel UI.
  return createPortal(<aside id="local-mcp-panel" hidden={!open} className="local-mcp-panel" aria-label="Local MCP" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <div className="local-mcp-heading">
      <h2>Local MCP</h2>
      <button type="button" className="local-mcp-close" title="Close panel; stay connected" onClick={onClose}>Close</button>
    </div>
    <p className="local-mcp-state">{session ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected'}</p>
    <p className="local-mcp-destination">Save to: {location.origin}</p>
    <div className="local-mcp-main-actions">
      {!session && savedConnection && <button className="local-mcp-primary" ref={reconnectRef} type="button" disabled={connecting} onClick={() => void connect(savedConnection)}>{connecting ? 'Connecting…' : 'Reconnect'}</button>}
      {!session && !savedConnection && setupForm}
      {session && <button ref={disconnectRef} type="button" onClick={()=>void disconnect()}>Disconnect local MCP</button>}
    </div>
    {(savedConnection || session) && <div className="local-mcp-advanced">
      <button type="button" className="local-mcp-disclosure" aria-expanded={advancedOpen} aria-controls="local-mcp-advanced-content"
        onClick={() => { setAdvancedOpen(value => !value); if (advancedOpen) setShowSetup(false); }}>
        <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span> Advanced settings
      </button>
      <div id="local-mcp-advanced-content" hidden={!advancedOpen}>
        <p>Server: {savedConnection?.origin ?? session?.origin}</p>
        {savedConnection?.auto && <p>Automatic opening {savedConnection.auto.paused?'paused':'enabled'} · {savedConnection.auto.browser} / {savedConnection.auto.profile}</p>}
        {session && autoAvailable && savedConnection && !savedConnection.auto && <>{profileFields}
          <button type="button" onClick={()=>void registerAuto(session,savedConnection).catch(error=>setStorageWarning(error.message))}>Enable automatic opening</button></>}
        <label className="local-mcp-remember"><input type="checkbox" checked={noteAccess} disabled={connecting}
          onChange={event => changeNoteAccess(event.target.checked)} />Allow reading and updating notes</label>
        <small>Applies to Codex chats on this PC.</small>
        <div className="local-mcp-settings-actions">
          {!session && <button type="button" disabled={connecting} aria-expanded={showSetup}
            onClick={() => setShowSetup(value => !value)}>{showSetup ? 'Cancel setup' : 'Use a new code'}</button>}
          <button type="button" disabled={connecting} onClick={forgetConnection}>Forget connection</button>
        </div>
        {!session && showSetup && setupForm}
      </div>
    </div>}
    {storageWarning && <p role="alert">{storageWarning}</p>}
    {status && <p role="status">{status}</p>}
  </aside>, document.body);
}
