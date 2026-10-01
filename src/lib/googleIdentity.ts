import { DRIVE_SCOPE } from './googleDrive'

type TokenResponse = { access_token?: string; expires_in?: number; error?: string }
type TokenClient = {
  callback: (response: TokenResponse) => void
  requestAccessToken: (options: { prompt: string }) => void
}
type PickerSelection = { action?: string; docs?: Array<{ id?: string; name?: string; mimeType?: string }> }
type PickerView = {
  setMimeTypes: (mime: string) => PickerView
  setIncludeFolders: (include: boolean) => PickerView
  setSelectFolderEnabled: (enabled: boolean) => PickerView
}
type PickerBuilder = {
  addView: (view: PickerView) => PickerBuilder
  setOAuthToken: (token: string) => PickerBuilder
  setDeveloperKey: (key: string) => PickerBuilder
  setAppId: (id: string) => PickerBuilder
  setOrigin: (origin: string) => PickerBuilder
  setCallback: (callback: (selection: PickerSelection) => void) => PickerBuilder
  build: () => { setVisible: (visible: boolean) => void }
}
type GoogleGlobal = {
  accounts: { oauth2: {
    initTokenClient: (options: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (response: { type?: string }) => void }) => TokenClient
    revoke: (token: string, callback: (response: { successful?: boolean; error?: string }) => void) => void
  } }
  picker?: { DocsView: new () => PickerView; PickerBuilder: new () => PickerBuilder }
}

function googleApi(): GoogleGlobal | undefined {
  return (window as unknown as { google?: GoogleGlobal }).google
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing?.dataset.loaded === 'true') return resolve()
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve() }, { once: true })
    script.addEventListener('error', () => {
      if (!existing) script.remove()
      reject(new Error('Google sign-in tools could not be loaded.'))
    }, { once: true })
    if (!existing) {
      script.src = src
      script.async = true
      document.head.appendChild(script)
    }
  })
}

let identityReady: Promise<void> | null = null
export function prepareGoogleIdentity(): Promise<void> {
  identityReady ??= loadScript('https://accounts.google.com/gsi/client').catch(error => {
    identityReady = null
    throw error
  })
  return identityReady
}

export function googleConfig() {
  return {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '',
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? '',
    appId: import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? '',
  }
}

export function googleConfigured(): boolean {
  const config = googleConfig()
  return !!(config.clientId && config.apiKey && config.appId)
}

export async function requestGoogleToken(previousToken: boolean): Promise<{ token: string; expiresAt: number }> {
  const config = googleConfig()
  if (!googleConfigured()) throw new Error('Google Drive is not configured for this deployment.')
  await prepareGoogleIdentity()
  const api = googleApi()
  if (!api) throw new Error('Google sign-in tools are unavailable.')
  return new Promise((resolve, reject) => {
    const client = api.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error('Google Drive connection was cancelled or denied.'))
          return
        }
        resolve({ token: response.access_token, expiresAt: Date.now() + Math.max(0, Number(response.expires_in) || 0) * 1000 })
      },
      error_callback: () => reject(new Error('Google Drive connection was cancelled or blocked.')),
    })
    try { client.requestAccessToken({ prompt: previousToken ? '' : 'consent' }) }
    catch (error) { reject(error) }
  })
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await prepareGoogleIdentity()
  const api = googleApi()
  if (!api) throw new Error('Google sign-in tools are unavailable.')
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Google Drive permission removal timed out.')), 15000)
    api.accounts.oauth2.revoke(token, (response) => {
      window.clearTimeout(timeout)
      if (response.successful) resolve()
      else reject(new Error('Google Drive permission could not be removed.'))
    })
  })
}

let pickerReady: Promise<void> | null = null
async function preparePicker(): Promise<void> {
  pickerReady ??= loadScript('https://apis.google.com/js/api.js').then(() => new Promise<void>((resolve, reject) => {
    const gapi = (window as unknown as { gapi?: { load: (api: string, options: { callback: () => void; onerror: () => void }) => void } }).gapi
    if (!gapi) return reject(new Error('Google folder picker is unavailable.'))
    gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google folder picker could not be loaded.')) })
  })).catch(error => { pickerReady = null; throw error })
  return pickerReady
}

export async function pickDriveFolder(token: string): Promise<{ id: string; name: string } | null> {
  await preparePicker()
  const picker = googleApi()?.picker
  const config = googleConfig()
  if (!picker) throw new Error('Google folder picker is unavailable.')
  return new Promise((resolve, reject) => {
    try {
      const view = new picker.DocsView()
        .setMimeTypes('application/vnd.google-apps.folder')
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
      const instance = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOrigin(window.location.origin)
        .setCallback(selection => {
          if (selection.action === 'cancel') { resolve(null); return }
          if (selection.action !== 'picked') return
          const folder = selection.docs?.[0]
          if (!folder?.id || folder.mimeType !== 'application/vnd.google-apps.folder') {
            reject(new Error('Choose a Google Drive folder.'))
            return
          }
          resolve({ id: folder.id, name: folder.name || 'Selected folder' })
        }).build()
      instance.setVisible(true)
    } catch (error) { reject(error) }
  })
}
