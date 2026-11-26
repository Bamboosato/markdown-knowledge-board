import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import './LocalMcpPanel.css';
import {readLocalMcpConnection} from '../lib/localMcpConnection';

const LocalMcpPanel = lazy(() => import('./LocalMcpPanel'));

export default function LocalMcpLauncher({ onReturnFocus }: { onReturnFocus: () => void }) {
  const [open, setOpen] = useState(import.meta.env.DEV && import.meta.env.MODE === 'local-mcp');
  const [activated, setActivated] = useState(()=>{const auto=readLocalMcpConnection()?.auto; return open || Boolean(auto && !auto.paused);});
  const hidePanel = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(onReturnFocus);
  }, [onReturnFocus]);
  useEffect(() => {
    const show = () => { setActivated(true); setOpen(true); };
    window.addEventListener('open-local-mcp', show);
    return () => window.removeEventListener('open-local-mcp', show);
  }, []);
  return activated ? (
    <Suspense fallback={null}>
      <LocalMcpPanel open={open} onClose={hidePanel} />
    </Suspense>
  ) : null;
}
