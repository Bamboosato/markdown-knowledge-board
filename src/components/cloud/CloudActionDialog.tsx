import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

type CloudActionDialogProps = {
  kind: 'sign-in' | 'backup' | 'disconnect'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const copy = {
  'sign-in': {
    title: 'Save changes before signing in?',
    body: 'Signing in with GitHub leaves this page. Save your changes before continuing.',
    confirm: 'Save and Continue',
  },
  backup: {
    title: 'Save changes before cloud backup?',
    body: 'Cloud backup uses the saved notes in this browser. Save your changes before continuing.',
    confirm: 'Save and Continue',
  },
  disconnect: {
    title: 'Disconnect GitHub?',
    body: 'This removes the connection from this browser. Local notes and the encrypted Gist backup will not be deleted.',
    confirm: 'Disconnect GitHub',
  },
} as const

export function CloudActionDialog({
  kind,
  busy = false,
  onConfirm,
  onCancel,
}: CloudActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const content = copy[kind]
  const titleId = `cloud-action-${kind}-title`
  const descriptionId = `cloud-action-${kind}-description`

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
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? [],
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
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
        className="cloud-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{content.title}</h2>
        <p id={descriptionId}>{content.body}</p>
        <div className="dialog-actions">
          <button
            ref={confirmButtonRef}
            className={kind === 'disconnect' ? 'danger-button' : 'primary-button'}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working' : content.confirm}
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
