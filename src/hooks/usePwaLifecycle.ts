import { useEffect, useSyncExternalStore } from 'react'

import { pwaController } from '../pwa/pwaController'

export function usePwaLifecycle() {
  const snapshot = useSyncExternalStore(
    pwaController.subscribe,
    pwaController.getSnapshot,
    pwaController.getSnapshot,
  )

  useEffect(() => {
    void pwaController.start()
  }, [])

  return {
    snapshot,
    promptInstall: () => pwaController.promptInstall(),
    deferUpdate: () => pwaController.deferUpdate(),
    applyUpdate: () => pwaController.applyUpdate(),
    checkForUpdate: () => pwaController.checkForUpdate(),
  }
}
