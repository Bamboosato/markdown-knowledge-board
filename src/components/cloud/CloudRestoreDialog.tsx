import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { CloudBackupMetadata } from '../../lib/cloudApi'
import type {
  CloudRestoreCounts,
  CloudRestorePreview,
} from '../../hooks/useCloudRestore'

type CommonProps = {
  busy?: boolean
  error?: string | null
}

type CloudRestoreDialogProps =
  | (CommonProps & { kind: 'downloading'; onCancel: () => void })
  | (CommonProps & {
      kind: 'passphrase'
      onSubmit: (passphrase: string) => void
      onCancel: () => void
    })
  | (CommonProps & {
      kind: 'selection'
      candidates: CloudBackupMetadata[]
      onSelect: (gistId: string) => void
      onCancel: () => void
    })
  | (CommonProps & { kind: 'none'; onClose: () => void })
  | (CommonProps & {
      kind: 'preview'
      preview: CloudRestorePreview
      onApply: () => void
      onCancel: () => void
    })
  | (CommonProps & {
      kind: 'result'
      counts: CloudRestoreCounts
      onClose: () => void
    })

function formatCandidate(candidate: CloudBackupMetadata): string {
  const updatedAt = new Date(candidate.updatedAt).toLocaleString()
  const size = (candidate.encryptedSize / 1_000_000).toFixed(2)
  return `${updatedAt} · ${size} MB · ${candidate.gistId.slice(0, 8)}`
}

function CountSummary({ counts }: { counts: CloudRestoreCounts }) {
  return (
    <dl className="cloud-restore-summary">
      <div><dt>Added</dt><dd>{counts.added}</dd></div>
      <div><dt>Updated</dt><dd>{counts.updated}</dd></div>
      <div><dt>Skipped</dt><dd>{counts.skipped}</dd></div>
      <div><dt>Conflicted</dt><dd>{counts.conflicted}</dd></div>
      <div><dt>Failed</dt><dd>{counts.failed}</dd></div>
    </dl>
  )
}

export function CloudRestoreDialog(props: CloudRestoreDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const firstControlRef = useRef<HTMLButtonElement | null>(null)
  const passphraseRef = useRef<HTMLInputElement | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const busy = props.busy ?? false

  useEffect(() => {
    if (props.kind === 'passphrase') passphraseRef.current?.focus()
    else firstControlRef.current?.focus()
  }, [props.kind])

  const close = () => {
    if ('onCancel' in props) props.onCancel()
    else if ('onClose' in props) props.onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.getModifierState('CapsLock')) setCapsLock(true)
    else if (event.key.length === 1) setCapsLock(false)
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled)',
      ) ?? [],
    )
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

  const submitPassphrase = () => {
    if (props.kind !== 'passphrase') return
    const submitted = passphrase
    setPassphrase('')
    props.onSubmit(submitted)
  }

  const title =
    props.kind === 'downloading'
      ? 'Download Cloud Backup'
      : props.kind === 'passphrase'
        ? 'Decrypt Cloud Backup'
        : props.kind === 'selection'
          ? 'Select Cloud Backup'
          : props.kind === 'none'
            ? 'No Cloud Backup Found'
            : props.kind === 'preview'
              ? 'Review Cloud Restore'
              : props.counts.failed > 0
                ? 'Cloud Restore Failed'
                : 'Cloud Restore Complete'
  const titleId = `cloud-restore-${props.kind}-title`

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="cloud-restore-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>

        {props.kind === 'downloading' ? (
          <>
            <p>Downloading and verifying the encrypted backup…</p>
            {props.error ? <div className="cloud-backup-error" role="alert">{props.error}</div> : null}
            <div className="dialog-actions">
              <button ref={firstControlRef} className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button>
            </div>
          </>
        ) : null}

        {props.kind === 'passphrase' ? (
          <>
            <p>Enter the passphrase used when this backup was created.</p>
            <label className="cloud-backup-field">
              Passphrase
              <span className="cloud-backup-password-control">
                <input
                  ref={passphraseRef}
                  type={showPassphrase ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={passphrase}
                  disabled={busy}
                  aria-describedby="cloud-restore-passphrase-help"
                  onChange={(event) => setPassphrase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !busy) submitPassphrase()
                  }}
                />
                <button
                  className="icon-button tooltip-button"
                  type="button"
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  aria-pressed={showPassphrase}
                  data-tooltip={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  disabled={busy}
                  onClick={() => setShowPassphrase((value) => !value)}
                >
                  {showPassphrase ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </span>
            </label>
            <div id="cloud-restore-passphrase-help" className="cloud-backup-help">At least 12 characters. The passphrase is not stored or sent.</div>
            {capsLock ? <div className="cloud-backup-warning" role="status">Caps Lock is on.</div> : null}
            {props.error ? <div className="cloud-backup-error" role="alert">{props.error}</div> : null}
            <div className="dialog-actions">
              <button className="primary-button" type="button" disabled={busy} onClick={submitPassphrase}>{busy ? 'Decrypting' : 'Decrypt Backup'}</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button>
            </div>
          </>
        ) : null}

        {props.kind === 'selection' ? (
          <>
            <p>More than one encrypted backup was found. Choose the Gist to restore from.</p>
            <div className="cloud-backup-candidates">
              {props.candidates.map((candidate, index) => (
                <button
                  key={candidate.gistId}
                  ref={index === 0 ? firstControlRef : undefined}
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
            <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button></div>
          </>
        ) : null}

        {props.kind === 'none' ? (
          <>
            <p>No Markdown Knowledge Board encrypted backup was found in this GitHub account.</p>
            <div className="dialog-actions"><button ref={firstControlRef} className="primary-button" type="button" onClick={props.onClose}>Close</button></div>
          </>
        ) : null}

        {props.kind === 'preview' ? (
          <>
            <dl className="cloud-restore-metadata">
              <div><dt>Created</dt><dd>{new Date(props.preview.createdAt).toLocaleString()}</dd></div>
              <div><dt>Cloud notes</dt><dd>{props.preview.noteCount}</dd></div>
            </dl>
            <CountSummary counts={props.preview.counts} />
            {props.preview.counts.conflicted > 0 ? (
              <div className="cloud-restore-conflicts">
                <h3>Conflicts kept local</h3>
                <ul>
                  {props.preview.plan.filter((item) => item.action === 'conflicted').map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.reason === 'local-newer' ? 'Local note is newer.' : 'Same timestamp with different content.'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="cloud-backup-help">Local-only notes are retained. Conflicts are never overwritten.</p>
            {props.error ? <div className="cloud-backup-error" role="alert">{props.error}</div> : null}
            <div className="dialog-actions">
              <button ref={firstControlRef} className="primary-button" type="button" disabled={busy} onClick={props.onApply}>{busy ? 'Applying' : 'Apply Safe Merge'}</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button>
            </div>
          </>
        ) : null}

        {props.kind === 'result' ? (
          <>
            <CountSummary counts={props.counts} />
            {props.counts.failed > 0 ? <p>No partial restore was kept; the IndexedDB transaction was rolled back.</p> : null}
            {props.error ? <div className="cloud-backup-error" role="alert">{props.error}</div> : null}
            <div className="dialog-actions"><button ref={firstControlRef} className="primary-button" type="button" onClick={props.onClose}>Close</button></div>
          </>
        ) : null}
      </div>
    </div>
  )
}
