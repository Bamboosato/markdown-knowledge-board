import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function MermaidPrintDialog({ onChoose }: { onChoose: (source: boolean | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [source, setSource] = useState(false);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog ref={ref} className="mermaid-print-dialog" aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const first = ref.current?.querySelector<HTMLInputElement>("input:checked");
        const last = ref.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); onChoose(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); onChoose(source); }}>
        <h2 id={titleId}>Mermaid output</h2>
        <p>Choose how to print all Mermaid diagrams in this document.</p>
        <label className="mermaid-print-option">
          <input type="radio" name="mermaid-output" checked={!source} onChange={() => setSource(false)} />
          <span><strong>Diagrams (recommended)</strong><small>Fit each diagram on one printed page.</small></span>
        </label>
        <label className="mermaid-print-option">
          <input type="radio" name="mermaid-output" checked={source} onChange={() => setSource(true)} />
          <span><strong>Source code</strong><small>Print the Mermaid source instead of diagrams.</small></span>
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={() => onChoose(null)}>Cancel</button>
          <button type="submit" className="primary-button">Continue to print</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
