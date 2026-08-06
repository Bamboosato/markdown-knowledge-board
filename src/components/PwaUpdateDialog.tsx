import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

type PwaUpdateDialogProps = {
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function PwaUpdateDialog({
  busy,
  error,
  onConfirm,
  onCancel,
}: PwaUpdateDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    confirmButtonRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onCancel()
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
        className="pwa-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-update-dialog-title"
        aria-describedby="pwa-update-dialog-description"
        aria-busy={busy || undefined}
        onKeyDown={handleKeyDown}
      >
        <h2 id="pwa-update-dialog-title">Update available</h2>
        <p id="pwa-update-dialog-description">
          Save your changes before restarting to update.
        </p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button
            ref={confirmButtonRef}
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Saving' : 'Save and restart'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
