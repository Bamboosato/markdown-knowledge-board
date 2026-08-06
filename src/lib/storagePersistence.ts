export type PersistenceResult =
  | 'persisted'
  | 'denied'
  | 'unsupported'
  | 'failed'

type StoragePersistenceApi = Pick<StorageManager, 'persisted' | 'persist'>

export function createStoragePersistenceRequester() {
  let resultPromise: Promise<PersistenceResult> | null = null

  return async function request(
    storage: StoragePersistenceApi | undefined = navigator.storage,
  ): Promise<PersistenceResult> {
    if (resultPromise) return resultPromise

    resultPromise = (async () => {
      if (!storage?.persisted || !storage.persist) return 'unsupported'
      try {
        if (await storage.persisted()) return 'persisted'
        return (await storage.persist()) ? 'persisted' : 'denied'
      } catch {
        return 'failed'
      }
    })()
    return resultPromise
  }
}

export const requestPersistentStorage = createStoragePersistenceRequester()
