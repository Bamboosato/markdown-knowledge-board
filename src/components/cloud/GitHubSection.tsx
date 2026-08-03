import {
  CloudDownload,
  CircleUser,
  CloudUpload,
  ExternalLink,
  LogOut,
  RefreshCw,
  Unlink,
} from 'lucide-react'
import type {
  CloudBackupDiscoveryState,
  CloudBackupNotice,
} from '../../hooks/useCloudBackup'
import type { GitHubSessionState } from '../../hooks/useGitHubSession'
import type { StoredCloudBackupMetadata } from '../../lib/cloudMetadata'
import { CLOUD_PRIMARY_ORIGIN } from '../../lib/cloudCapability'

type GitHubSectionProps = {
  session: GitHubSessionState
  isOnline: boolean
  isSecondaryOrigin: boolean
  notice: {
    tone: 'success' | 'warning'
    message: string
    settingsUrl?: string
  } | null
  busyAction: 'signout' | 'disconnect' | null
  cloudBackup: {
    discovery: CloudBackupDiscoveryState
    storedMetadata: StoredCloudBackupMetadata | null
    notice: CloudBackupNotice | null
    uploading: boolean
    restoring: boolean
  }
  onSignIn: () => void
  onRetry: () => void
  onSignOut: () => void
  onDisconnect: () => void
  onCloudBackup: () => void
  onCloudRestore: () => void
  onCloudRetry: () => void
}

export function GitHubSection({
  session,
  isOnline,
  isSecondaryOrigin,
  notice,
  busyAction,
  cloudBackup,
  onSignIn,
  onRetry,
  onSignOut,
  onDisconnect,
  onCloudBackup,
  onCloudRestore,
  onCloudRetry,
}: GitHubSectionProps) {
  const unavailableLabel =
    session.status === 'unavailable' && session.reason === 'offline'
      ? isOnline
        ? 'Connection restored. Retry to check GitHub.'
        : 'Offline. Local editing remains available.'
      : session.status === 'unavailable' && session.reason === 'timeout'
        ? 'GitHub connection check timed out.'
        : 'GitHub is temporarily unavailable.'

  return (
    <div className="github-menu-section" role="presentation">
      <div className="github-menu-status" aria-live="polite">
        {session.status === 'checking' ? 'Checking GitHub connection…' : null}
        {session.status === 'signed-in'
          ? `Connected as @${session.user.login}`
          : null}
        {session.status === 'reauthorization-required'
          ? 'Reauthorization required.'
          : null}
        {session.status === 'unavailable' ? unavailableLabel : null}
      </div>

      {session.status === 'signed-out' ||
      session.status === 'reauthorization-required' ? (
        <button
          className="app-menu-item"
          type="button"
          role="menuitem"
          onClick={onSignIn}
        >
          <CircleUser aria-hidden="true" />
          Sign in with GitHub
        </button>
      ) : null}

      {session.status === 'unavailable' ? (
        <button
          className="app-menu-item"
          type="button"
          role="menuitem"
          disabled={!isOnline}
          onClick={onRetry}
        >
          <RefreshCw aria-hidden="true" />
          Retry
        </button>
      ) : null}

      {session.status === 'signed-in' ? (
        <>
          <button
            className="app-menu-item"
            type="button"
            role="menuitem"
            disabled={
              !isOnline ||
              busyAction !== null ||
              cloudBackup.uploading ||
              cloudBackup.restoring ||
              cloudBackup.discovery.status === 'checking'
            }
            onClick={onCloudBackup}
          >
            <CloudUpload aria-hidden="true" />
            {cloudBackup.uploading ? 'Backing Up' : 'Cloud Backup'}
          </button>
          <button
            className="app-menu-item"
            type="button"
            role="menuitem"
            disabled={
              !isOnline ||
              busyAction !== null ||
              cloudBackup.uploading ||
              cloudBackup.restoring ||
              cloudBackup.discovery.status === 'checking'
            }
            onClick={onCloudRestore}
          >
            <CloudDownload aria-hidden="true" />
            {cloudBackup.restoring ? 'Restoring' : 'Restore from Cloud'}
          </button>
          {cloudBackup.discovery.status === 'unavailable' ? (
            <button
              className="app-menu-item"
              type="button"
              role="menuitem"
              disabled={!isOnline || busyAction !== null}
              onClick={onCloudRetry}
            >
              <RefreshCw aria-hidden="true" />
              Retry Cloud Check
            </button>
          ) : null}
          <button
            className="app-menu-item"
            type="button"
            role="menuitem"
            disabled={busyAction !== null}
            onClick={onSignOut}
          >
            <LogOut aria-hidden="true" />
            {busyAction === 'signout' ? 'Signing out' : 'Sign out'}
          </button>
          <button
            className="app-menu-item app-menu-item-danger"
            type="button"
            role="menuitem"
            disabled={busyAction !== null}
            onClick={onDisconnect}
          >
            <Unlink aria-hidden="true" />
            {busyAction === 'disconnect'
              ? 'Disconnecting'
              : 'Disconnect GitHub'}
          </button>
        </>
      ) : null}

      {session.status === 'signed-in' && cloudBackup.storedMetadata ? (
        <div className="github-menu-status">
          Last cloud backup:{' '}
          {new Date(cloudBackup.storedMetadata.updatedAt).toLocaleString()}
        </div>
      ) : null}

      {session.status === 'signed-in' && cloudBackup.notice ? (
        <div
          className={`github-menu-notice github-menu-notice-${cloudBackup.notice.tone}`}
          role={cloudBackup.notice.tone === 'warning' ? 'alert' : 'status'}
        >
          {cloudBackup.notice.message}
        </div>
      ) : null}

      {notice ? (
        <div
          className={`github-menu-notice github-menu-notice-${notice.tone}`}
          role={notice.tone === 'warning' ? 'alert' : 'status'}
        >
          {notice.message}
          {notice.settingsUrl ? (
            <a href={notice.settingsUrl} target="_blank" rel="noreferrer">
              Open GitHub settings
              <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      {isSecondaryOrigin ? (
        <div className="github-origin-notice">
          <span>Local data is stored separately for this address.</span>
          <a href={CLOUD_PRIMARY_ORIGIN}>
            Open the primary address
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  )
}
