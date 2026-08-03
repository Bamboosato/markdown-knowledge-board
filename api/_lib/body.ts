export const ENCRYPTED_BACKUP_MAX_BYTES = 4_500_000

export class BodyReadError extends Error {
  readonly code:
    | 'INVALID_CONTENT_LENGTH'
    | 'PAYLOAD_TOO_LARGE'
    | 'UNSUPPORTED_CONTENT_ENCODING'

  constructor(code: BodyReadError['code']) {
    super(code)
    this.name = 'BodyReadError'
    this.code = code
  }
}

export async function readRawBodyWithLimit(
  request: Request,
  limit = ENCRYPTED_BACKUP_MAX_BYTES,
): Promise<Uint8Array> {
  const contentEncoding = request.headers.get('Content-Encoding')
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new BodyReadError('UNSUPPORTED_CONTENT_ENCODING')
  }

  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new BodyReadError('INVALID_CONTENT_LENGTH')
    }
    if (Number(contentLength) > limit) {
      throw new BodyReadError('PAYLOAD_TOO_LARGE')
    }
  }

  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new BodyReadError('PAYLOAD_TOO_LARGE')
    }
    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
