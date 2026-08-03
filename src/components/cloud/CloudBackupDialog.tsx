import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { CloudBackupMetadata } from '../../lib/cloudApi'
import { PASSPHRASE_LOSS_WARNING } from '../../lib/cloudCrypto'

type CloudBackupDialogProps =
  | {
      kind: 'passphrase'
      busy: boolean
      error: string | null
      onSubmit: (passphrase: string, confirmation: string) => void
      onCancel: () => void
    }
  | {
      kind: 'empty-warning'
      busy?: boolean
      onConfirm: () => void
      onCancel: () => void
    }
  | {
      kind: 'selection'
      busy: boolean
      candidates: CloudBackupMetadata[]
      error: string | null
      onSelect: (gistId: string) => void
      onCancel: () => void
    }
  | {
      kind: 'conflict'
      busy: boolean
      error: string | null
      onReplace: () => void
      onCancel: () => void
    }

function formatCandidate(candidate: CloudBackupMetadata): string {
  const updatedAt = new Date(candidate.updatedAt).toLocaleString()
  const size = (candidate.encryptedSize / 1_000_000).toFixed(2)
  return `${updatedAt} · ${size} MB · ${candidate.gistId.slice(0, 8)}`
}

export function CloudBackupDialog(props: CloudBackupDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const firstButtonRef = useRef<HTMLButtonElement | null>(null)
  const passphraseRef = useRef<HTMLInputElement | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  useEffect(() => {
    if (props.kind === 'passphrase') passphraseRef.current?.focus()
    else firstButtonRef.current?.focus()
  }, [props.kind])

  const busy = props.busy ?? false
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.getModifierState('CapsLock')) setCapsLock(true)
    else if (event.key.length === 1) setCapsLock(false)
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      props.onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled)',
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

  const title =
    props.kind === 'passphrase'
      ? 'Encrypt Cloud Backup'
      : props.kind === 'empty-warning'
        ? 'Replace the cloud backup with an empty backup?'
        : props.kind === 'selection'
          ? 'Select Cloud Backup'
          : 'Cloud Backup Changed'
  const titleId = `cloud-backup-${props.kind}-title`

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="cloud-backup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>

        {props.kind === 'passphrase' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              props.onSubmit(passphrase, confirmation)
            }}
          >
            <p>
              Your notes are encrypted in this browser before they are sent to
              GitHub.
            </p>
            <p className="cloud-backup-warning">{PASSPHRASE_LOSS_WARNING}</p>
            <label className="cloud-backup-field">
              <span>Passphrase</span>
              <span className="cloud-backup-password-control">
                <input
                  ref={passphraseRef}
                  type={showPassphrase ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={passphrase}
                  disabled={busy}
                  aria-describedby="cloud-backup-passphrase-help"
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  aria-pressed={showPassphrase}
                  disabled={busy}
                  onClick={() => setShowPassphrase((current) => !current)}
                >
                  {showPassphrase ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </span>
            </label>
            <div id="cloud-backup-passphrase-help" className="cloud-backup-help">
              Use at least 12 characters. Spaces and pasted text are allowed.
            </div>
            <label className="cloud-backup-field">
              <span>Confirm passphrase</span>
              <input
                type={showPassphrase ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {capsLock ? (
              <div className="cloud-backup-warning" role="status">
                Caps Lock is on.
              </div>
            ) : null}
            {props.error ? (
              <div className="cloud-backup-error" role="alert">
                {props.error}
              </div>
            ) : null}
            <div className="dialog-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Encrypting and Uploading' : 'Encrypt and Back Up'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={props.onCancel}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {props.kind === 'empty-warning' ? (
          <>
            <p>
              The existing cloud backup contains data. This action cannot be
              undone from this app.
            </p>
            <div className="dialog-actions">
              <button
                ref={firstButtonRef}
                className="danger-button"
                type="button"
                onClick={props.onConfirm}
              >
                Continue
              </button>
              <button className="secondary-button" type="button" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {props.kind === 'selection' ? (
          <>
            <p>More than one encrypted backup was found. Choose the Gist to update.</p>
            <div className="cloud-backup-candidates">
              {props.candidates.map((candidate, index) => (
                <button
                  key={candidate.gistId}
                  ref={index === 0 ? firstButtonRef : undefined}
                  className="cloud-backup-candidate"
                  type="button"
                  disabled={busy}
                  onClick={() => props.onSelect(candidate.gistId)}
                >
                  {formatCandidate(candidate)}
                </button>
              ))}
            </div>
            {props.error ? <div className="cloud-backup-error" role="alert">{props.error}</div> : null}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={props.onCancel}
              >
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {props.kind === 'conflict' ? (
          <>
            <p>
              The encrypted Gist changed after this browser checked it. It was
              not overwritten.
            </p>
            <p>
              Review the latest backup before replacing it. Continuing will ask
              for the passphrase again and use a fresh local snapshot.
            </p>
            {props.error ? <div className="cloud-backup-error" role="alert">{props.error}</div> : null}
            <div className="dialog-actions">
              <button
                ref={firstButtonRef}
                className="danger-button"
                type="button"
                disabled={busy}
                onClick={props.onReplace}
              >
                Replace Cloud Backup
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={props.onCancel}
              >
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
