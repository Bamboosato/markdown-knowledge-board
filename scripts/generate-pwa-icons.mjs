import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(
  repositoryRoot,
  'docs/assets/phase3-pwa-icon-a-master.svg',
)
const outputDirectory = resolve(repositoryRoot, 'public/icons')
const outputs = [
  { fileName: 'pwa-192.png', size: 192 },
  { fileName: 'pwa-512.png', size: 512 },
  { fileName: 'pwa-maskable-512.png', size: 512 },
  { fileName: 'apple-touch-icon.png', size: 180 },
]

const svg = await readFile(sourcePath, 'utf8')
await mkdir(outputDirectory, { recursive: true })

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const output of outputs) {
    await page.setViewportSize({ width: output.size, height: output.size })
    await page.setContent(`<!doctype html>
      <style>
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #1d1d1d; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      ${svg}`)
    await page.screenshot({
      path: resolve(outputDirectory, output.fileName),
      type: 'png',
      scale: 'css',
    })
    console.log(`generated ${output.fileName} (${output.size}x${output.size})`)
  }
} finally {
  await browser.close()
}
