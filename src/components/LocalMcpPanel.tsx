import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveLocalMcpNote } from '../lib/localMcpNote';
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
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const [token, setToken] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [status, setStatus] = useState('Connect to receive new notes in this app on this PC.');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (open) (session ? disconnectRef : addressRef).current?.focus();
  }, [open, session]);

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

  async function connect() {
    setConnecting(true);
    setConnectionError(false);
    try {
      const url = new URL(address.trim());
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
          url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Use the http://127.0.0.1:port address supplied by the MCP tool.');
      }
      if (!/^[a-f0-9]{64}$/.test(token.trim())) throw new Error('Enter the pairing token supplied by the MCP tool.');
      const next = { token: token.trim(), clientId: crypto.randomUUID(), origin: url.origin };
      await request(next, 'connect', {}, AbortSignal.timeout(60000));
      if (!mountedRef.current) {
        await request(next, 'disconnect').catch(() => {});
        return;
      }
      setSession(next);
      setToken('');
      setStatus('Connected. New notes will appear in the list without switching your editor.');
      onConnected();
    } catch (error) {
      setConnectionError(true);
      setStatus(error instanceof TypeError ? 'Cannot connect. Check that the MCP server is running and allow this app to connect to this PC when the browser asks.' : error instanceof Error ? error.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  }

  // Keep this component mounted while hidden: polling and the session outlive the panel UI.
  return createPortal(<aside id="local-mcp-panel" hidden={!open} className="local-mcp-panel" aria-label="Local MCP" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <button type="button" className="local-mcp-close" onClick={onClose}>閉じる</button>
    <details open>
      <summary>Local MCP — {session ? 'Connected' : 'Disconnected'}</summary>
      <p>保存先: {location.origin}。パネルを閉じても接続は維持されます。</p>
      {!session ? <form onSubmit={event => { event.preventDefault(); void connect(); }}>
        <label htmlFor="local-mcp-address">Server address</label>
        <input ref={addressRef} id="local-mcp-address" type="url" placeholder="http://127.0.0.1:port"
          autoComplete="off" value={address} onChange={event => setAddress(event.target.value)} disabled={connecting} />
        <label htmlFor="local-mcp-token">Pairing token</label>
        <input id="local-mcp-token" type="password" autoComplete="off" value={token}
          onChange={event => setToken(event.target.value)} disabled={connecting} />
        <button type="submit" disabled={connecting || !token.trim() || !address.trim()}>Connect local MCP</button>
      </form> : <button ref={disconnectRef} type="button" onClick={() => {
        setSession(null);
        setConnectionError(false);
        setStatus('Disconnected.');
      }}>Disconnect local MCP</button>}
      <p role="status">{status}</p>
    </details>
  </aside>, document.body);
}
