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

class LocalMcpRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(session: Session, operation: string, value = {}, signal?: AbortSignal) {
  const response = await fetch(`${session.origin}/__local_mcp/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ clientId: session.clientId, ...value }),
    signal: signal ?? AbortSignal.timeout(10000),
    credentials: 'omit', cache: 'no-store', redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok) throw new LocalMcpRequestError(response.status, result.error ?? 'Local MCP connection failed.');
  return result;
}

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

  async function registerAuto(active:Session,value:LocalMcpConnection) {
    if (!/^(?:Default|Profile [1-9][0-9]{0,3})$/.test(profile)) throw Error('Enter Default or Profile followed by its number.');
    const key=value.auto?.key ?? Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
    const auto:AutoProfile={key,browser,profile,paused:false};
    // Keep the proof locally before sending it, including if the reply is lost.
    if (enrolling.current) return;
    enrolling.current=true;
    try {
      rememberConnection({...value,auto:{...auto,paused:true}});
      try {
        await request(active, 'auto', {...auto, action:'enable'});
      } catch (error) {
        if (error instanceof LocalMcpRequestError && error.status < 500) rememberConnection(value);
        throw error;
      }
      rememberConnection({...value,auto});
    } finally {enrolling.current=false;}
  }

  async function disconnect() {
    if (savedConnection?.auto) {
      const saved={...savedConnection,auto:{...savedConnection.auto,paused:true}};
      try {
        rememberConnection(saved);
        await request(session ?? { ...savedConnection, clientId: crypto.randomUUID() },'auto',{action:'pause',key:saved.auto.key});
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
      setShowSetup(false);
      setSetupAuto(false);
      setRemember(false);
      setStorageWarning('');
    } catch {
      setStorageWarning('Could not forget this connection. Check browser site settings.');
    }
  }

  async function connect(saved?: LocalMcpConnection, automatic=false, enroll=false) {
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
      const openSession = () => request(next, 'connect', {
        protocolVersion: 2, supportedOperations, supportedMetadataActions, noteAccess: allowed, profileKey: bound?.key,
      }, AbortSignal.timeout(60000));
      const connected = await openSession().catch(async error => {
        if (!enroll || !(error instanceof LocalMcpRequestError) || error.status !== 409) throw error;
        // A recently closed tab keeps its broker lease for up to five seconds.
        await new Promise(resolve => setTimeout(resolve, 5100));
        if (!mountedRef.current) throw error;
        return openSession();
      });
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
        if (saved || remember || enroll) {
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
      if (enroll && !remembered) return;
      if (enroll && !bound) {
        setRemember(true);
        try {
          if (!connected.autoAvailable) throw Error('Update the local Windows MCP runtime to enable automatic opening.');
          await registerAuto(next,{...credentials,noteAccess:allowed});
        } catch (error) {
          setStorageWarning(error instanceof Error?error.message:'Automatic opening could not be confirmed.');
          return;
        }
      }
      setStatus('Ready to receive notes.');
      setAdvancedOpen(false);
      setSetupAuto(false);
      if (remembered && !automatic && !enroll && !bound) onClose();
    } catch (error) {
      setConnectionError(true);
      if (saved && !automatic && !enroll && !saved.auto) { setSetupAuto(false); setShowSetup(true); setAdvancedOpen(true); }
      setStatus(enroll && error instanceof LocalMcpRequestError ? error.message : saved ? 'Reconnect failed. Start your MCP client and close other connected tabs, then retry.'
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

  const profileFields=<>
    <label>Browser <select value={browser} onChange={event=>setBrowser(event.target.value as 'chrome'|'edge')}><option value="chrome">Chrome</option><option value="edge">Edge</option></select></label>
    <label>Profile directory <input value={profile} maxLength={12} onChange={event=>setProfile(event.target.value)} /></label>
    <small>Use the last folder in Profile Path at {browser==='edge'?'edge://version':'chrome://version'}, for example Default or Profile 1.</small>
  </>;
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

  async function enableAuto() {
    if (!session) {
      await connect(savedConnection ?? undefined, false, true);
      return;
    }
    setConnecting(true);
    try {
      if (!autoAvailable) throw Error('Update the local Windows MCP runtime to enable automatic opening.');
      await registerAuto(session, savedConnection ?? {origin: session.origin, token: session.token, noteAccess});
      setRemember(true);
      setSetupAuto(false);
      setStorageWarning('');
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : 'Automatic opening could not be confirmed.');
    } finally {
      setConnecting(false);
    }
  }

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
      {auto && savedConnection ? <button type="button" disabled={connecting} onClick={() => auto.paused ? void connect(savedConnection) : void disconnect()}>
        {auto.paused ? 'Resume automatic connection' : 'Pause automatic connection'}
      </button> : setupAuto ? <form onSubmit={event => { event.preventDefault(); void enableAuto(); }}>
        {needsCredentials && credentialsFields}
        {profileFields}
        <button className="local-mcp-primary" type="submit" disabled={connecting || (needsCredentials && missingCredentials)}>Register save destination</button>
        <button type="button" disabled={connecting} onClick={() => setSetupAuto(false)}>Cancel</button>
      </form> : <>
        <p>Open this browser profile when your local agent saves a note.</p>
        <button className="local-mcp-primary" type="button" disabled={connecting} onClick={() => {
          setSetupAuto(true); setShowSetup(false);
        }}>Set up automatic connection</button>
      </>}
    </section>
    <details>
      <summary>Manual connection <span>{connectionState}</span></summary>
      {session ? <button type="button" disabled={connecting} onClick={() => void disconnect()}>
        {auto ? 'Disconnect and pause automatic connection' : 'Disconnect local MCP'}
      </button> : savedConnection ? <button type="button" disabled={connecting} onClick={() => void connect(savedConnection)}>
        {auto?.paused ? 'Reconnect and resume' : 'Reconnect'}
      </button> : !setupAuto && manualForm}
    </details>
    <details>
      <summary>Note access</summary>
      <label className="local-mcp-remember"><input type="checkbox" checked={noteAccess} disabled={connecting || (!session && !savedConnection)}
        onChange={event => changeNoteAccess(event.target.checked)} />Allow reading and updating notes</label>
      <small>Optional for saving new notes.</small>
    </details>
    <div className="local-mcp-advanced">
      <button type="button" className="local-mcp-disclosure" aria-expanded={advancedOpen} aria-controls="local-mcp-advanced-content"
        onClick={() => { setAdvancedOpen(!advancedOpen); setShowSetup(false); }}>
        <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span> Advanced settings
      </button>
      <div id="local-mcp-advanced-content" hidden={!advancedOpen}>
        {(savedConnection || session) && <p>Server: {savedConnection?.origin ?? session?.origin}</p>}
        {!session && <label className="local-mcp-remember"><input type="checkbox" checked={manual}
          onChange={event => setManual(event.target.checked)} />Enter address and token</label>}
        <div className="local-mcp-settings-actions">
          {!session && savedConnection && <button type="button" disabled={connecting} onClick={() => {
            setShowSetup(!showSetup); setSetupAuto(false);
          }}>{showSetup ? 'Cancel setup' : 'Use a new code'}</button>}
          {savedConnection && <button type="button" disabled={connecting} onClick={() => void forgetConnection()}>Forget connection</button>}
        </div>
        {!session && savedConnection && showSetup && manualForm}
      </div>
    </div>
    {storageWarning && <p role="alert">{storageWarning}</p>}
    {status && <p role="status">{status}</p>}
  </aside>, document.body);
}
