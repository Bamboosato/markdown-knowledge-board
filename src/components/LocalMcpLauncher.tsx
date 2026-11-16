import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import './LocalMcpPanel.css';

const LocalMcpPanel = lazy(() => import('./LocalMcpPanel'));

export default function LocalMcpLauncher() {
  const [open, setOpen] = useState(import.meta.env.DEV && import.meta.env.MODE === 'local-mcp');
  const [activated, setActivated] = useState(open);
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
  const label = { connected: 'MCP接続中', connecting: 'MCP接続待ち', disconnected: 'MCP未接続', error: 'MCP接続エラー' }[connection];
  return activated ? <>
    <button ref={indicatorRef} type="button" className={`local-mcp-indicator local-mcp-${connection}`}
      aria-label={`${label}：接続設定を開く`} aria-expanded={open} aria-controls="local-mcp-panel"
      title={`${label}：クリックして接続設定・切断`} onClick={() => setOpen(value => !value)}>
      <span className="local-mcp-dot" aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
    <Suspense fallback={null}><LocalMcpPanel open={open} onClose={hidePanel}
      onConnected={hidePanel} onConnectionChange={setConnection} /></Suspense>
  </> : null;
}
