import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { DriveFile } from '../../lib/googleDrive'
import type { RestorePlanItem } from '../../lib/cloudRestore'
import { PASSPHRASE_LOSS_WARNING } from '../../lib/cloudCrypto'

export type GoogleDialogMode = 'backup' | 'backup-empty' | 'folder-choice' | 'restore-list' | 'restore-passphrase' | 'restore-preview' | 'restore-result' | 'export-choice' | 'export-result' | 'disconnect'

export function GoogleDriveDialog(props: {
  mode: GoogleDialogMode
  busy: boolean
  error: string | null
  files: DriveFile[]
  folders: DriveFile[]
  selected: DriveFile | null
  plan: RestorePlanItem[]
  result: string | null
  onCancel: () => void
  onBackup: (passphrase: string, confirmation: string) => void
  onSelect: (file: DriveFile) => void
  onSelectFolder: (folder: DriveFile) => void
  onPrepare: (passphrase: string) => void
  onApply: () => void
  onExportLocal: () => void
  onExportDrive: () => void
  driveEnabled: boolean
  onDisconnect: () => void
  onContinueEmpty: () => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const firstRef = useRef<HTMLButtonElement | HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { firstRef.current?.focus() }, [props.mode])
  const { mode, busy } = props
  const title = {
    backup: 'Encrypt Google Drive Backup',
    'backup-empty': 'Back up an empty note collection?',
    'folder-choice': 'Select MKB Backups Folder',
    'restore-list': 'Select Google Drive Backup',
    'restore-passphrase': 'Restore from Google Drive',
    'restore-preview': 'Review Google Drive Restore',
    'restore-result': 'Google Drive Restore Complete',
    'export-choice': 'Export Markdown',
    'export-result': 'Markdown Export Complete',
    disconnect: 'Disconnect Google Drive?',
  }[mode]
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); props.onCancel(); return }
    if (event.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])
    if (!items.length) return
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
  }
  return (
    <div className="modal-backdrop">
      <div ref={dialogRef} className="cloud-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="google-drive-dialog-title" aria-busy={busy || undefined} onKeyDown={onKeyDown}>
        <h2 id="google-drive-dialog-title">{title}</h2>
        {mode === 'backup' && (
          <form onSubmit={event => { event.preventDefault(); props.onBackup(passphrase, confirmation) }}>
            <p>Notes are encrypted in this browser before upload to MKB Backups.</p>
            <p className="cloud-backup-warning">{PASSPHRASE_LOSS_WARNING}</p>
            <label className="cloud-backup-field"><span>Passphrase</span><input ref={firstRef as React.RefObject<HTMLInputElement>} type="password" autoComplete="new-password" value={passphrase} disabled={busy} onChange={event => setPassphrase(event.target.value)} /></label>
            <label className="cloud-backup-field"><span>Confirm passphrase</span><input type="password" autoComplete="new-password" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
            <p className="cloud-backup-help">At least 12 characters. The passphrase is not stored or sent.</p>
            {props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}
            <div className="dialog-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Uploading' : 'Encrypt and Back Up'}</button><button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button></div>
          </form>
        )}
        {mode === 'backup-empty' && <><p>This creates a new empty backup. Earlier backups will remain available.</p><div className="dialog-actions"><button ref={firstRef as React.RefObject<HTMLButtonElement>} className="primary-button" type="button" onClick={props.onContinueEmpty}>Continue</button><button className="secondary-button" type="button" onClick={props.onCancel}>Cancel</button></div></>}
        {mode === 'folder-choice' && <><p>More than one app-managed backup folder was found. Choose which one to use.</p><div className="cloud-backup-candidates">{props.folders.map((folder, index) => <button key={folder.id} ref={index === 0 ? firstRef as React.RefObject<HTMLButtonElement> : undefined} className="cloud-backup-candidate" type="button" disabled={busy} onClick={() => props.onSelectFolder(folder)}>{folder.name} · {folder.id.slice(0, 12)}</button>)}</div>{props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={props.onCancel}>Cancel</button></div></>}
        {mode === 'restore-list' && <>
          {busy ? <p>Checking MKB Backups…</p> : props.files.length ? <><p>Select a backup generation to restore.</p><div className="cloud-backup-candidates">{props.files.map((file, index) => <button key={file.id} ref={index === 0 ? firstRef as React.RefObject<HTMLButtonElement> : undefined} className="cloud-backup-candidate" type="button" disabled={busy} onClick={() => props.onSelect(file)}>{new Date(file.modifiedTime || 0).toLocaleString()} · {file.name}</button>)}</div></> : !props.error ? <p>No encrypted backup was found in MKB Backups.</p> : null}
          {props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}
          <div className="dialog-actions"><button ref={!props.files.length ? firstRef as React.RefObject<HTMLButtonElement> : undefined} className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Close</button></div>
        </>}
        {mode === 'restore-passphrase' && <form onSubmit={event => { event.preventDefault(); props.onPrepare(passphrase) }}><p>Enter the backup passphrase. Changes will be reviewed before applying them.</p><label className="cloud-backup-field"><span>Passphrase</span><input ref={firstRef as React.RefObject<HTMLInputElement>} type="password" autoComplete="current-password" value={passphrase} disabled={busy} onChange={event => setPassphrase(event.target.value)} /></label>{props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}<div className="dialog-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Preparing' : 'Review Restore'}</button><button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button></div></form>}
        {mode === 'restore-preview' && <><p>Added: {props.plan.filter(x => x.action === 'added').length} · Updated: {props.plan.filter(x => x.action === 'updated').length} · Skipped: {props.plan.filter(x => x.action === 'skipped').length} · Conflicted: {props.plan.filter(x => x.action === 'conflicted').length}</p>{props.plan.some(x => x.action === 'conflicted') && <div className="cloud-restore-conflicts"><h3>Conflicts kept local</h3><ul>{props.plan.filter(x => x.action === 'conflicted').map(x => <li key={x.id}><strong>{x.title}</strong><span>{x.reason === 'local-newer' ? 'Local note is newer.' : 'Same timestamp with different content.'}</span></li>)}</ul></div>}<p className="cloud-backup-help">Local-only notes and conflicting notes are kept.</p>{props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}<div className="dialog-actions"><button ref={firstRef as React.RefObject<HTMLButtonElement>} className="primary-button" type="button" disabled={busy} onClick={props.onApply}>{busy ? 'Applying' : 'Apply Safe Merge'}</button><button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button></div></>}
        {mode === 'restore-result' && <><p role="status">{props.result}</p><div className="dialog-actions"><button ref={firstRef as React.RefObject<HTMLButtonElement>} className="primary-button" type="button" onClick={props.onCancel}>Close</button></div></>}
        {mode === 'export-result' && <><p role="status">{props.result}</p><div className="dialog-actions"><button ref={firstRef as React.RefObject<HTMLButtonElement>} className="primary-button" type="button" onClick={props.onCancel}>Close</button></div></>}
        {mode === 'export-choice' && <><p>Choose where to export the current note.</p><p className="cloud-backup-help">Google Drive stores readable Markdown. Apps with access to the file can read it.</p>{!props.driveEnabled && <p className="cloud-backup-help">Connect Google Drive from the application menu to enable this destination.</p>}{props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}<div className="dialog-actions"><button ref={firstRef as React.RefObject<HTMLButtonElement>} className="secondary-button" type="button" disabled={busy} onClick={props.onExportLocal}>Local</button><button className="primary-button" type="button" disabled={busy || !props.driveEnabled} onClick={props.onExportDrive}>{busy ? 'Exporting' : 'Google Drive'}</button><button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button></div></>}
        {mode === 'disconnect' && <><p>This removes Google Drive access. Local notes, backups and exported Markdown remain in place.</p>{props.error && <p className="cloud-backup-error" role="alert">{props.error}</p>}<div className="dialog-actions"><button ref={firstRef as React.RefObject<HTMLButtonElement>} className="danger-button" type="button" disabled={busy} onClick={props.onDisconnect}>Disconnect Google Drive</button><button className="secondary-button" type="button" disabled={busy} onClick={props.onCancel}>Cancel</button></div></>}
      </div>
    </div>
  )
}
