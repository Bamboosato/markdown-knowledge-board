import { CircleUser, CloudDownload, CloudUpload, Unlink } from 'lucide-react'
import type { DriveAccount } from '../../lib/googleDrive'
import type { GoogleDriveStatus } from '../../hooks/useGoogleDrive'

export function GoogleDriveSection(props: {
  status: GoogleDriveStatus
  account: DriveAccount | null
  notice: string | null
  result: string | null
  busy: boolean
  operationBusy: boolean
  isOnline: boolean
  onConnect: () => void
  onDisconnect: () => void
  onBackup: () => void
  onRestore: () => void
}) {
  const { status, account, notice, result, busy, operationBusy, isOnline } = props
  const disabled = !isOnline || busy || operationBusy
  return (
    <div className="github-menu-section" role="presentation">
      <div className="github-menu-status" aria-live="polite">
        {status === 'connecting' ? 'Connecting to Google Drive…' : null}
        {status === 'signed-in' && account ? `Connected as ${account.label}` : null}
        {status === 'reauthorization-required' ? 'Reconnect to Google Drive.' : null}
        {status === 'unconfigured' ? 'Google Drive is not configured for this deployment.' : null}
        {!isOnline ? 'Offline. Local editing remains available.' : null}
      </div>
      {(status === 'signed-out' || status === 'reauthorization-required') && (
        <button className="app-menu-item" type="button" role="menuitem" disabled={disabled} onClick={props.onConnect}>
          <CircleUser aria-hidden="true" />Connect Google Drive
        </button>
      )}
      {status === 'signed-in' && (
        <>
          <button className="app-menu-item" type="button" role="menuitem" disabled={disabled} onClick={props.onBackup}>
            <CloudUpload aria-hidden="true" />Cloud Backup
          </button>
          <button className="app-menu-item" type="button" role="menuitem" disabled={disabled} onClick={props.onRestore}>
            <CloudDownload aria-hidden="true" />Restore from Cloud
          </button>
          <button className="app-menu-item app-menu-item-danger" type="button" role="menuitem" disabled={busy || operationBusy} onClick={props.onDisconnect}>
            <Unlink aria-hidden="true" />Disconnect Google Drive
          </button>
        </>
      )}
      {notice ? <div className="github-menu-notice github-menu-notice-warning" role="alert">{notice}</div> : null}
      {result && status === 'signed-in' ? <div className="github-menu-notice github-menu-notice-success" role="status">{result}</div> : null}
    </div>
  )
}
