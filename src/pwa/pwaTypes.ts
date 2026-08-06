export type PwaRegistrationState =
  | 'disabled'
  | 'unsupported'
  | 'registering'
  | 'ready'
  | 'error'

export type PwaInstallState =
  | 'unavailable'
  | 'available'
  | 'prompting'
  | 'dismissed'
  | 'installed'
  | 'ios-help'

export type PwaUpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'waiting'
  | 'applying'
  | 'error'

export type PwaSnapshot = {
  registration: PwaRegistrationState
  connectivity: 'online' | 'offline'
  install: PwaInstallState
  update: PwaUpdateState
  updateDeferred: boolean
  offlineReady: boolean
  error?: {
    operation: 'register' | 'install' | 'update'
    message: string
  }
}
