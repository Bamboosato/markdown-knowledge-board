import { registerSW } from 'virtual:pwa-register'

import { getPwaCapability } from '../lib/pwaCapability'
import { requestPersistentStorage } from '../lib/storagePersistence'
import type { PwaInstallState, PwaSnapshot } from './pwaTypes'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type PwaListener = () => void
type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const APPLY_ERROR_MESSAGE =
  'Update failed. Keep using the current version and try again.'

function isStandalone(): boolean {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean
  }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  )
}

function isIphoneSafari(): boolean {
  const userAgent = navigator.userAgent
  return (
    /iPhone|iPad|iPod/i.test(userAgent) &&
    /Safari/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent)
  )
}

function getInitialInstallState(): PwaInstallState {
  if (isStandalone()) return 'installed'
  if (isIphoneSafari()) return 'ios-help'
  return 'unavailable'
}

function sanitizeErrorName(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) return error.name
  return 'UnknownError'
}

class PwaController {
  private snapshot: PwaSnapshot = {
    registration: 'disabled',
    connectivity: navigator.onLine ? 'online' : 'offline',
    install: getInitialInstallState(),
    update: 'idle',
    updateDeferred: false,
    offlineReady: false,
  }
  private readonly listeners = new Set<PwaListener>()
  private startPromise: Promise<void> | null = null
  private registration: ServiceWorkerRegistration | undefined
  private installPrompt: BeforeInstallPromptEvent | null = null
  private updateServiceWorker: UpdateServiceWorker | null = null
  private lastUpdateCheckAt = 0
  private reloadRequested = false
  private shouldReloadAfterUpdate = false
  private browserListenersAttached = false

  getSnapshot = (): PwaSnapshot => this.snapshot

  subscribe = (listener: PwaListener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal()
    return this.startPromise
  }

  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const prompt = this.installPrompt
    if (!prompt) return 'unavailable'

    this.updateSnapshot({ install: 'prompting', error: undefined })
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      this.installPrompt = null
      if (choice.outcome === 'accepted') {
        this.updateSnapshot({ install: 'installed' })
        void requestPersistentStorage()
        return 'accepted'
      }
      this.updateSnapshot({ install: 'dismissed' })
      return 'dismissed'
    } catch (error) {
      this.updateSnapshot({
        install: 'available',
        error: {
          operation: 'install',
          message: sanitizeErrorName(error),
        },
      })
      return 'unavailable'
    }
  }

  deferUpdate(): void {
    if (this.snapshot.update !== 'waiting') return
    this.updateSnapshot({ updateDeferred: true })
  }

  async applyUpdate(): Promise<boolean> {
    if (this.snapshot.update !== 'waiting' || !this.updateServiceWorker) {
      return false
    }
    this.shouldReloadAfterUpdate = true
    this.updateSnapshot({
      update: 'applying',
      updateDeferred: false,
      error: undefined,
    })
    try {
      await this.updateServiceWorker(true)
      return true
    } catch (error) {
      this.shouldReloadAfterUpdate = false
      console.warn('PWA update apply failed', {
        operation: 'update',
        error: sanitizeErrorName(error),
      })
      this.updateSnapshot({
        update: 'error',
        error: { operation: 'update', message: APPLY_ERROR_MESSAGE },
      })
      return false
    }
  }

  async checkForUpdate(options: { revealDeferred?: boolean } = {}): Promise<void> {
    if (!this.registration || this.snapshot.connectivity === 'offline') return
    if (this.snapshot.update === 'applying') return

    const hadWaitingUpdate = this.snapshot.update === 'waiting'
    this.lastUpdateCheckAt = Date.now()
    this.updateSnapshot({
      update: hadWaitingUpdate ? 'waiting' : 'checking',
      updateDeferred: options.revealDeferred ? false : this.snapshot.updateDeferred,
      error: undefined,
    })
    try {
      await this.registration.update()
      if (!hadWaitingUpdate && this.snapshot.update === 'checking') {
        this.updateSnapshot({ update: 'idle' })
      }
    } catch (error) {
      console.warn('PWA update check failed', {
        operation: 'update',
        error: sanitizeErrorName(error),
      })
      if (!hadWaitingUpdate) {
        this.updateSnapshot({
          update: 'error',
          error: {
            operation: 'update',
            message: 'Update check failed. Keep using the current version.',
          },
        })
      }
    }
  }

  private async startInternal(): Promise<void> {
    const capability = getPwaCapability()
    if (capability.status !== 'enabled') {
      this.updateSnapshot({
        registration: capability.status,
        install: capability.status === 'unsupported' ? 'unavailable' : this.snapshot.install,
      })
      return
    }

    this.attachBrowserListeners()
    this.updateSnapshot({ registration: 'registering' })
    try {
      this.updateServiceWorker = registerSW({
        immediate: true,
        onNeedRefresh: () => {
          this.updateSnapshot({
            update: 'waiting',
            updateDeferred: false,
            error: undefined,
          })
        },
        onOfflineReady: () => {
          this.updateSnapshot({ offlineReady: true })
        },
        onRegisteredSW: (_scriptUrl, registration) => {
          this.registration = registration
          this.lastUpdateCheckAt = Date.now()
          this.updateSnapshot({ registration: 'ready', error: undefined })
        },
        onNeedReload: () => {
          if (!this.shouldReloadAfterUpdate || this.reloadRequested) return
          this.reloadRequested = true
          window.location.reload()
        },
        onRegisterError: (error) => {
          console.warn('PWA registration failed', {
            operation: 'register',
            error: sanitizeErrorName(error),
          })
          this.updateSnapshot({
            registration: 'error',
            error: {
              operation: 'register',
              message: 'Offline support could not be prepared. Online editing is still available.',
            },
          })
        },
      })
    } catch (error) {
      console.warn('PWA registration failed', {
        operation: 'register',
        error: sanitizeErrorName(error),
      })
      this.updateSnapshot({
        registration: 'error',
        error: {
          operation: 'register',
          message: 'Offline support could not be prepared. Online editing is still available.',
        },
      })
    }
  }

  private attachBrowserListeners(): void {
    if (this.browserListenersAttached) return
    this.browserListenersAttached = true

    window.addEventListener('beforeinstallprompt', (event) => {
      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      this.installPrompt = promptEvent
      this.updateSnapshot({ install: 'available', error: undefined })
    })
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null
      this.updateSnapshot({ install: 'installed', error: undefined })
      void requestPersistentStorage()
    })
    window.addEventListener('online', () => {
      this.updateSnapshot({ connectivity: 'online' })
    })
    window.addEventListener('offline', () => {
      this.updateSnapshot({ connectivity: 'offline' })
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - this.lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return
      void this.checkForUpdate({ revealDeferred: true })
    })
  }

  private updateSnapshot(patch: Partial<PwaSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

export const pwaController = new PwaController()
