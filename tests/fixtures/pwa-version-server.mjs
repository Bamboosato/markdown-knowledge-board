import { createServer } from 'node:http'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const sourceDirectory = resolve(repositoryRoot, 'dist')
const fixtureRoot = resolve(repositoryRoot, 'output/pwa-version-fixture')
const versionOneDirectory = resolve(fixtureRoot, 'v1')
const versionTwoDirectory = resolve(fixtureRoot, 'v2')
const port = Number(process.env.PLAYWRIGHT_PORT ?? '4177')
let activeVersion = 'v1'

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
])

async function prepareVersions() {
  await rm(fixtureRoot, { recursive: true, force: true })
  await mkdir(fixtureRoot, { recursive: true })
  await cp(sourceDirectory, versionOneDirectory, { recursive: true })
  await cp(sourceDirectory, versionTwoDirectory, { recursive: true })

  const indexPath = resolve(versionTwoDirectory, 'index.html')
  const workerPath = resolve(versionTwoDirectory, 'sw.js')
  const index = await readFile(indexPath, 'utf8')
  const worker = await readFile(workerPath, 'utf8')
  const versionedIndex = index.replace(
    '</head>',
    '<meta name="pwa-test-version" content="v2" /></head>',
  )
  const versionedWorker = worker.replace(
    /({url:"index\.html",revision:")[^"]+("})/,
    '$1f2e3d4c5b6a79800112233445566778$2',
  )
  if (versionedIndex === index || versionedWorker === worker) {
    throw new Error('Could not create a distinct PWA v2 fixture')
  }
  await writeFile(indexPath, versionedIndex)
  await writeFile(workerPath, versionedWorker)
}

function cacheControl(pathname) {
  if (
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/index.html' ||
    pathname === '/'
  ) {
    return 'no-cache, max-age=0, must-revalidate'
  }
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  return 'no-cache'
}

await prepareVersions()

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)

  if (url.pathname === '/__pwa-test/version') {
    const requestedVersion = url.searchParams.get('value')
    if (requestedVersion !== 'v1' && requestedVersion !== 'v2') {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'value must be v1 or v2' }))
      return
    }
    activeVersion = requestedVersion
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    })
    response.end(JSON.stringify({ activeVersion }))
    return
  }

  if (url.pathname.startsWith('/api/')) {
    response.writeHead(503, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    })
    response.end(JSON.stringify({ error: 'PWA_TEST_API_UNAVAILABLE' }))
    return
  }

  const activeDirectory =
    activeVersion === 'v1' ? versionOneDirectory : versionTwoDirectory
  const requestedPath =
    url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
  let filePath = resolve(activeDirectory, requestedPath)
  const relativePath = relative(activeDirectory, filePath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  let body
  try {
    body = await readFile(filePath)
  } catch {
    if (request.headers.accept?.includes('text/html')) {
      filePath = resolve(activeDirectory, 'index.html')
      body = await readFile(filePath)
    } else {
      response.writeHead(404)
      response.end('Not found')
      return
    }
  }

  const extension = extname(filePath)
  response.writeHead(200, {
    'Cache-Control': cacheControl(url.pathname),
    'Content-Type': mimeTypes.get(extension) ?? 'application/octet-stream',
  })
  response.end(body)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`PWA version server listening on http://127.0.0.1:${port}`)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
