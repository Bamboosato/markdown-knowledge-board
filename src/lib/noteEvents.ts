export function notifyNotesChanged() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event('mkb-notes-changed'));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mkb-notes');
      channel.postMessage('changed');
      channel.close();
    }
  } catch { /* A notification failure cannot undo or misreport a committed write. */ }
}

// The app vetoes updates to dirty/busy editors. Block user input only for the commit
// interval, without moving focus or modifying the user's draft.
export function acquireNoteUpdate(id: string): () => void {
  if (typeof window === 'undefined') return () => {};
  const event = new CustomEvent('mkb-before-note-update', { cancelable: true, detail: { id } });
  if (!window.dispatchEvent(event)) throw new Error('NOTE_BUSY');
  const block = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const events = ['beforeinput', 'keydown', 'pointerdown', 'click', 'paste', 'drop', 'compositionstart'];
  events.forEach(name => document.addEventListener(name, block, true));
  return () => events.forEach(name => document.removeEventListener(name, block, true));
}
