import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { clearHostCookie, serializeCookie } from './cookies.js'
import type { OriginConfig } from './origins.js'
import type { SessionKey, SessionKeyRing } from './session.js'

export const OAUTH_STATE_COOKIE_NAME = '__Host-mkb_oauth_state'
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60

const OAUTH_STATE_FORMAT_VERSION = 'v1'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export type OAuthStatePayloadV1 = {
  version: 1
  state: string
  codeVerifier: string
  originKey: OriginConfig['key']
  returnPath: '/'
  issuedAt: number
  expiresAt: number
}

export class OAuthStateError extends Error {
  constructor() {
    super('OAUTH_STATE_INVALID')
    this.name = 'OAuthStateError'
  }
}

function oauthStateAad(keyId: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    `${OAUTH_STATE_COOKIE_NAME}:${OAUTH_STATE_FORMAT_VERSION}:${keyId}`,
  )
}

function isOAuthStatePayload(value: unknown): value is OAuthStatePayloadV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return (
    payload.version === 1 &&
    typeof payload.state === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(payload.state) &&
    typeof payload.codeVerifier === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(payload.codeVerifier) &&
    (payload.originKey === 'primary' || payload.originKey === 'vercel') &&
    payload.returnPath === '/' &&
    typeof payload.issuedAt === 'number' &&
    Number.isSafeInteger(payload.issuedAt) &&
    typeof payload.expiresAt === 'number' &&
    Number.isSafeInteger(payload.expiresAt) &&
    payload.expiresAt > payload.issuedAt
  )
}

async function importAesKey(key: SessionKey, usage: KeyUsage[]): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    key.bytes,
    { name: 'AES-GCM' },
    false,
    usage,
  )
}

export async function sealOAuthState(
  payload: OAuthStatePayloadV1,
  keyRing: SessionKeyRing,
  iv: Uint8Array<ArrayBuffer> = Uint8Array.from(randomBytes(12)),
): Promise<string> {
  if (!isOAuthStatePayload(payload) || iv.byteLength !== 12) {
    throw new OAuthStateError()
  }

  const key = await importAesKey(keyRing.active, ['encrypt'])
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: oauthStateAad(keyRing.active.id),
      tagLength: 128,
    },
    key,
    textEncoder.encode(JSON.stringify(payload)),
  )
  return [
    OAUTH_STATE_FORMAT_VERSION,
    keyRing.active.id,
    Buffer.from(iv).toString('base64url'),
    Buffer.from(encrypted).toString('base64url'),
  ].join('.')
}

export async function unsealOAuthState(
  value: string,
  keyRing: SessionKeyRing,
): Promise<OAuthStatePayloadV1> {
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== OAUTH_STATE_FORMAT_VERSION) {
    throw new OAuthStateError()
  }
  const [, keyId, encodedIv, encodedCiphertext] = parts
  if (!keyId || !encodedIv || !encodedCiphertext) throw new OAuthStateError()
  const stateKey = keyRing.byId.get(keyId)
  if (!stateKey) throw new OAuthStateError()

  try {
    const iv = Uint8Array.from(Buffer.from(encodedIv, 'base64url'))
    const ciphertext = Uint8Array.from(
      Buffer.from(encodedCiphertext, 'base64url'),
    )
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) {
      throw new OAuthStateError()
    }
    const key = await importAesKey(stateKey, ['decrypt'])
    const decrypted = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: oauthStateAad(keyId),
        tagLength: 128,
      },
      key,
      ciphertext,
    )
    const payload: unknown = JSON.parse(textDecoder.decode(decrypted))
    if (!isOAuthStatePayload(payload)) throw new OAuthStateError()
    return payload
  } catch (error) {
    if (error instanceof OAuthStateError) throw error
    throw new OAuthStateError()
  }
}

export function oauthStateCookie(value: string): string {
  return serializeCookie(OAUTH_STATE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  })
}

export function clearOAuthStateCookie(): string {
  return clearHostCookie(OAUTH_STATE_COOKIE_NAME)
}
