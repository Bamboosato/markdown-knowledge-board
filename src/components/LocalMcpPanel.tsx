import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveLocalMcpNote } from '../lib/localMcpNote';
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
  const [showSetup, setShowSetup] = useState(!savedConnection);
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
  }, [open, session, showSetup, manual]);

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
        const { job } = await request(session, 'poll', {}, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
        if (stopped) return;
        if (job) {
          let receipt;
          try {
            const saved = await saveLocalMcpNote(job.input);
            window.dispatchEvent(new CustomEvent('local-mcp-note-saved', { detail: saved.note }));
            receipt = { id: saved.note.id, title: saved.note.title, reused: saved.reused };
            if (!stopped) setStatus(`${saved.reused ? 'Already saved' : 'Saved'}: ${saved.note.title}`);
          } catch (error) {
            receipt = { error: 'SAVE_FAILED' };
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
      await request(next, 'connect', {}, AbortSignal.timeout(60000));
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
          localStorage.setItem(LOCAL_MCP_CONNECTION_KEY, JSON.stringify(credentials));
          setSavedConnection(credentials);
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
      if (remembered) onConnected();
    } catch (error) {
      setConnectionError(true);
      if (saved) setShowSetup(true);
      setStatus(saved ? 'Reconnect failed. Start Codex and close other connected tabs, then retry.'
        : error instanceof TypeError ? 'Cannot connect. Check Codex and browser permissions.' : error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  }

  // Keep this component mounted while hidden: polling and the session outlive the panel UI.
  return createPortal(<aside id="local-mcp-panel" hidden={!open} className="local-mcp-panel" aria-label="Local MCP" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <button type="button" className="local-mcp-close" title="Close panel; stay connected" onClick={onClose}>Close</button>
    <details open>
      <summary>Local MCP — {session ? 'Connected' : 'Disconnected'}</summary>
      <p>Save to: {location.origin}</p>
      {savedConnection && <div className="local-mcp-remembered">
        <p>Server: {savedConnection.origin}</p>
        {!session && <button ref={reconnectRef} type="button" disabled={connecting} onClick={() => void connect(savedConnection)}>Reconnect</button>}
        <button type="button" disabled={connecting} onClick={forgetConnection}>Forget connection</button>
        {!session && <button type="button" disabled={connecting} aria-expanded={showSetup}
          onClick={() => setShowSetup(value => !value)}>{showSetup ? 'Cancel setup' : 'Use a new code'}</button>}
      </div>}
      {!session && (!savedConnection || showSetup) ? <form onSubmit={event => { event.preventDefault(); void connect(); }}>
        {!manual && <>
          <label htmlFor="local-mcp-code">Connection code</label>
          <input ref={codeRef} id="local-mcp-code" type="password" autoComplete="off" placeholder="Paste code from this chat"
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
        <button type="submit" disabled={connecting || (manual ? !token.trim() || !address.trim() : !code.trim())}>Connect local MCP</button>
      </form> : null}
      {session && <button ref={disconnectRef} type="button" onClick={() => {
        setSession(null);
        setConnectionError(false);
        setStatus('Disconnected.');
      }}>Disconnect local MCP</button>}
      {storageWarning && <p role="alert">{storageWarning}</p>}
      {status && <p role="status">{status}</p>}
    </details>
  </aside>, document.body);
}
