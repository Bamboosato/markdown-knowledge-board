import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import './LocalMcpPanel.css';
import {readLocalMcpConnection} from '../lib/localMcpConnection';

const LocalMcpPanel = lazy(() => import('./LocalMcpPanel'));

export default function LocalMcpLauncher() {
  const [open, setOpen] = useState(import.meta.env.DEV && import.meta.env.MODE === 'local-mcp');
  const [activated, setActivated] = useState(()=>{const auto=readLocalMcpConnection()?.auto; return open || Boolean(auto && !auto.paused);});
  const [connection, setConnection] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const indicatorRef = useRef<HTMLButtonElement>(null);
  const hidePanel = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => indicatorRef.current?.focus());
  }, []);
  useEffect(() => {
    const show = () => { setActivated(true); setOpen(true); };
    window.addEventListener('open-local-mcp', show);
    return () => window.removeEventListener('open-local-mcp', show);
  }, []);
  const label = { connected: 'MCP connected', connecting: 'MCP connecting', disconnected: 'MCP disconnected', error: 'MCP connection error' }[connection];
  return activated ? <>
    <button ref={indicatorRef} type="button" className={`local-mcp-indicator local-mcp-${connection}`}
      aria-label={`${label}: connection settings`} aria-expanded={open} aria-controls="local-mcp-panel"
      title="Connection settings" onClick={() => setOpen(value => !value)}>
      <span className="local-mcp-dot" aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
    <Suspense fallback={null}><LocalMcpPanel open={open} onClose={hidePanel}
      onConnected={hidePanel} onConnectionChange={setConnection} /></Suspense>
  </> : null;
}
