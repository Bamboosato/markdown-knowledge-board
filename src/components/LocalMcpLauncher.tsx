import { lazy, Suspense, useEffect, useState } from 'react';

const LocalMcpPanel = lazy(() => import('./LocalMcpPanel'));

export default function LocalMcpLauncher() {
  const [open, setOpen] = useState(import.meta.env.DEV && import.meta.env.MODE === 'local-mcp');
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('open-local-mcp', show);
    return () => window.removeEventListener('open-local-mcp', show);
  }, []);
  return open ? <Suspense fallback={null}><LocalMcpPanel onClose={() => {
    setOpen(false);
    window.dispatchEvent(new Event('close-local-mcp'));
  }} /></Suspense> : null;
}
