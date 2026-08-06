import { gzipSync } from 'node:zlib'
import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDirectory = resolve(repositoryRoot, 'dist')
const requiredManifestFields = [
  'id',
  'name',
  'short_name',
  'start_url',
  'scope',
  'display',
  'theme_color',
  'background_color',
  'icons',
]
const requiredIcons = new Map([
  ['icons/pwa-192.png', { width: 192, height: 192, purpose: 'any' }],
  ['icons/pwa-512.png', { width: 512, height: 512, purpose: 'any' }],
  [
    'icons/pwa-maskable-512.png',
    { width: 512, height: 512, purpose: 'maskable' },
  ],
])
const precacheExtensions = new Set([
  '.html',
  '.js',
  '.css',
  '.svg',
  '.png',
  '.ico',
  '.webmanifest',
])
const errors = []

function fail(message) {
  errors.push(message)
}

function normalizePath(path) {
  return path.split(sep).join('/')
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot)
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else files.push(path)
  }
  return files
}

function readPngDimensions(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('not a PNG')
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  }
}

const manifestPath = resolve(distDirectory, 'manifest.webmanifest')
const workerPath = resolve(distDirectory, 'sw.js')
const indexPath = resolve(distDirectory, 'index.html')
const [manifestText, workerText, indexText] = await Promise.all([
  readFile(manifestPath, 'utf8'),
  readFile(workerPath, 'utf8'),
  readFile(indexPath, 'utf8'),
])
const manifest = JSON.parse(manifestText)

for (const field of requiredManifestFields) {
  if (!(field in manifest)) fail(`manifest is missing ${field}`)
}
if (manifest.id !== '/' || manifest.start_url !== '/' || manifest.scope !== '/') {
  fail('manifest id, start_url, and scope must all be /')
}
if (manifest.display !== 'standalone') fail('manifest display must be standalone')
if (manifest.theme_color !== '#1d1d1d') fail('unexpected manifest theme_color')

for (const [source, contract] of requiredIcons) {
  const manifestIcon = manifest.icons?.find((icon) => icon.src === source)
  if (!manifestIcon) {
    fail(`manifest is missing icon ${source}`)
    continue
  }
  if (manifestIcon.purpose !== contract.purpose) {
    fail(`${source} purpose must be ${contract.purpose}`)
  }
  if (
    manifestIcon.sizes !== `${contract.width}x${contract.height}` ||
    manifestIcon.type !== 'image/png'
  ) {
    fail(`${source} manifest size or MIME type is invalid`)
  }
  const iconBuffer = await readFile(resolve(distDirectory, source))
  const dimensions = readPngDimensions(iconBuffer)
  if (
    dimensions.width !== contract.width ||
    dimensions.height !== contract.height
  ) {
    fail(`${source} must be ${contract.width}x${contract.height}`)
  }
  if (dimensions.colorType === 4 || dimensions.colorType === 6) {
    fail(`${source} must not contain an alpha channel`)
  }
}

const appleTouchIcon = readPngDimensions(
  await readFile(resolve(distDirectory, 'icons/apple-touch-icon.png')),
)
if (appleTouchIcon.width !== 180 || appleTouchIcon.height !== 180) {
  fail('icons/apple-touch-icon.png must be 180x180')
}
if (appleTouchIcon.colorType === 4 || appleTouchIcon.colorType === 6) {
  fail('icons/apple-touch-icon.png must not contain an alpha channel')
}

if (!indexText.includes('rel="manifest"')) fail('index.html has no manifest link')
if (!indexText.includes('rel="apple-touch-icon"')) {
  fail('index.html has no Apple touch icon link')
}
if (!indexText.includes('name="theme-color"')) {
  fail('index.html has no theme-color metadata')
}

const precacheUrls = new Set(
  Array.from(workerText.matchAll(/\{url:"([^"]+)"/g), (match) => match[1]),
)
if (!precacheUrls.has('index.html')) fail('sw.js has no navigation fallback')
if (!workerText.includes('denylist') || !workerText.includes('api')) {
  fail('sw.js has no /api navigation denylist')
}
for (const url of precacheUrls) {
  if (/\/api(?:\/|$)|auth\/session|cloud-backups|github\.com/i.test(url)) {
    fail(`sw.js precaches forbidden URL ${url}`)
  }
}

const distFiles = await listFiles(distDirectory)
const cacheCandidates = distFiles.filter((path) => {
  const relativePath = normalizePath(relative(distDirectory, path))
  return (
    precacheExtensions.has(extensionOf(relativePath)) &&
    relativePath !== 'sw.js' &&
    !relativePath.startsWith('workbox-')
  )
})

let rawTotal = 0
let gzipTotal = 0
let largest = { path: '', size: 0 }
for (const path of cacheCandidates) {
  const relativePath = normalizePath(relative(distDirectory, path))
  const buffer = await readFile(path)
  const fileStats = await stat(path)
  rawTotal += fileStats.size
  gzipTotal += gzipSync(buffer).length
  if (fileStats.size > largest.size) largest = { path: relativePath, size: fileStats.size }
  if (fileStats.size > 4_000_000) fail(`${relativePath} exceeds 4,000,000 bytes`)
  if (!precacheUrls.has(relativePath)) fail(`${relativePath} is not in precache`)
}
if (gzipTotal > 5 * 1024 * 1024) {
  fail(`precache gzip total ${gzipTotal} exceeds 5 MiB`)
}

console.log(`precache files: ${cacheCandidates.length}`)
console.log(`precache raw bytes: ${rawTotal}`)
console.log(`precache gzip bytes: ${gzipTotal}`)
console.log(`largest precache asset: ${largest.path} (${largest.size} bytes)`)

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`)
  process.exitCode = 1
} else {
  console.log('PWA build verification passed')
}
