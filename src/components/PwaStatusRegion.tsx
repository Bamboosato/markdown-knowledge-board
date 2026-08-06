import type { PwaSnapshot } from '../pwa/pwaTypes'

type PwaStatusRegionProps = {
  snapshot: PwaSnapshot
  hiddenForDialog: boolean
  updateBlocked: boolean
  onRestart: () => void
  onLater: () => void
}

export function PwaStatusRegion({
  snapshot,
  hiddenForDialog,
  updateBlocked,
  onRestart,
  onLater,
}: PwaStatusRegionProps) {
  const showOffline = snapshot.connectivity === 'offline'
  const showUpdate =
    snapshot.update === 'waiting' &&
    !snapshot.updateDeferred &&
    !hiddenForDialog
  const showUpdateError =
    snapshot.update === 'error' && snapshot.error?.operation === 'update'

  if (!showOffline && !showUpdate && !showUpdateError) return null

  return (
    <div className="pwa-status-region" aria-label="Application status">
      {showOffline ? (
        <div className="pwa-status-message pwa-offline-status" role="status" aria-live="polite">
          <strong>Offline</strong>
          <span>Local notes remain available. Cloud actions need a connection.</span>
        </div>
      ) : null}
      {showUpdate ? (
        <div className="pwa-status-message pwa-update-notice" role="status" aria-live="polite">
          <strong>Update available</strong>
          <div className="pwa-status-actions">
            <button
              className="primary-button"
              type="button"
              data-pwa-update-action
              disabled={updateBlocked}
              aria-describedby={updateBlocked ? 'pwa-update-blocked-help' : undefined}
              onClick={onRestart}
            >
              Restart to update
            </button>
            <button className="secondary-button" type="button" onClick={onLater}>
              Later
            </button>
          </div>
          {updateBlocked ? (
            <span id="pwa-update-blocked-help" className="pwa-status-help">
              Finish the current action before updating.
            </span>
          ) : null}
        </div>
      ) : null}
      {showUpdateError ? (
        <div className="pwa-status-message pwa-update-error" role="alert">
          {snapshot.error?.message}
        </div>
      ) : null}
    </div>
  )
}
