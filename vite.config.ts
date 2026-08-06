import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const pwaBuildEnabled =
    env.VITE_PWA_ENABLED === 'true' ||
    env.VITE_PWA_TEST_ENABLED === 'true'

  return {
    plugins: [
      react(),
      VitePWA({
        disable: !pwaBuildEnabled,
        strategies: 'generateSW',
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: [
          'favicon.svg',
          'icons/pwa-192.png',
          'icons/pwa-512.png',
          'icons/pwa-maskable-512.png',
          'icons/apple-touch-icon.png',
        ],
        manifest: {
          id: '/',
          name: 'Markdown Knowledge Board',
          short_name: 'Knowledge Board',
          description: 'A local-first Markdown knowledge board.',
          lang: 'en',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#1d1d1d',
          background_color: '#f7f7f7',
          categories: ['productivity'],
          icons: [
            {
              src: 'icons/pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/pwa-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{html,js,css,svg,png,ico,webmanifest}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api(?:\/|$)/],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
          skipWaiting: false,
          clientsClaim: false,
          maximumFileSizeToCacheInBytes: 4_000_000,
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
  }
})
