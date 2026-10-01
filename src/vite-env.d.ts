/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_BACKUP_ENABLED?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_GOOGLE_API_KEY?: string
  readonly VITE_GOOGLE_APP_ID?: string
  readonly VITE_PWA_ENABLED?: string
  readonly VITE_PWA_TEST_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
