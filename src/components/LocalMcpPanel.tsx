import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveLocalMcpNote } from '../lib/localMcpNote';
import { executeNoteAccess } from '../lib/localMcpAccess';
import { NoteAccessError } from '../lib/noteRevision';
import { LOCAL_MCP_CONNECTION_KEY, parseLocalMcpCode, readLocalMcpConnection, validateLocalMcpConnection } from '../lib/localMcpConnection';
import type { LocalMcpConnection } from '../lib/localMcpConnection';
import './LocalMcpPanel.css';

type Session = { token: string; clientId: string; origin: string };

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
  const [showSetup, setShowSetup] = useState(!savedConnection);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [remember, setRemember] = useState(Boolean(savedConnection));
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
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { job } = await request(session, 'poll', { protocolVersion: 2, noteAccess: noteAccessRef.current }, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
        if (stopped) return;
        if (job) {
          let receipt;
          try {
            if (job.operation && job.operation !== 'create_note') {
              receipt = await executeNoteAccess(job.operation, job.input, () => !stopped && noteAccessRef.current);
              if (!stopped && job.operation === 'update_note') setStatus('Note update completed.');
            } else {
            const saved = await saveLocalMcpNote(job.input);
            window.dispatchEvent(new CustomEvent('local-mcp-note-saved', { detail: saved.note }));
            receipt = { id: saved.note.id, title: saved.note.title, reused: saved.reused };
            if (!stopped) setStatus(`${saved.reused ? 'Already saved' : 'Saved'}: ${saved.note.title}`);
            }
          } catch (error) {
            receipt = !job.operation || job.operation === 'create_note' ? { error: 'SAVE_FAILED' } : {
              error: { code: error instanceof NoteAccessError ? error.code : 'SAVE_FAILED',
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
      clearTimeout(timer);
      controller.abort();
      void request(session, 'disconnect').catch(() => {});
    };
  }, [session]);

  function forgetConnection() {
    try {
      localStorage.removeItem(LOCAL_MCP_CONNECTION_KEY);
      noteAccessRef.current = false;
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

  async function connect(saved?: LocalMcpConnection) {
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
      await request(next, 'connect', { protocolVersion: 2, noteAccess: allowed }, AbortSignal.timeout(60000));
      if (!mountedRef.current) {
        await request(next, 'disconnect').catch(() => {});
        return;
      }
      setSession(next);
      setToken('');
      setCode('');
      let remembered = true;
      try {
        if (remember) {
          const rememberedConnection = { ...credentials, noteAccess: allowed };
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

  function changeNoteAccess(allowed: boolean) {
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
        <small>Private devices only. No automatic connection.</small>
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
      {session && <button ref={disconnectRef} type="button" onClick={() => {
        setSession(null);
        setConnectionError(false);
        setStatus('Disconnected.');
      }}>Disconnect local MCP</button>}
    </div>
    {(savedConnection || session) && <div className="local-mcp-advanced">
      <button type="button" className="local-mcp-disclosure" aria-expanded={advancedOpen} aria-controls="local-mcp-advanced-content"
        onClick={() => { setAdvancedOpen(value => !value); if (advancedOpen) setShowSetup(false); }}>
        <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span> Advanced settings
      </button>
      <div id="local-mcp-advanced-content" hidden={!advancedOpen}>
        <p>Server: {savedConnection?.origin ?? session?.origin}</p>
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
