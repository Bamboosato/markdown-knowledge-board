import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

type PwaInstallHelpDialogProps = {
  onClose: () => void
}

export function PwaInstallHelpDialog({ onClose }: PwaInstallHelpDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="pwa-install-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-help-title"
        onKeyDown={handleKeyDown}
      >
        <h2 id="pwa-install-help-title">Install on iPhone</h2>
        <ol>
          <li>Open Safari's Share menu.</li>
          <li>Select Add to Home Screen.</li>
          <li>Turn on Open as Web App.</li>
          <li>Select Add.</li>
        </ol>
        <div className="dialog-actions">
          <button
            ref={closeButtonRef}
            className="primary-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
