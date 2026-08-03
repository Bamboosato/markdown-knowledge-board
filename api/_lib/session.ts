import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { clearHostCookie, serializeCookie } from './cookies.js'
import type { ServerEnvironment } from './environment.js'

export const SESSION_COOKIE_NAME = '__Host-mkb_session'
export const SESSION_COOKIE_VALUE_MAX_BYTES = 3_800

const SESSION_FORMAT_VERSION = 'v1'
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export type SessionPayloadV1 = {
  version: 1
  user: { id: number; login: string; avatarUrl: string }
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
  issuedAt: number
}

export type SessionKey = {
  id: string
  bytes: Uint8Array<ArrayBuffer>
}

export type SessionKeyRing = {
  active: SessionKey
  byId: ReadonlyMap<string, SessionKey>
}

export class SessionError extends Error {
  readonly code:
    | 'SESSION_CONFIG_INVALID'
    | 'SESSION_INVALID'
    | 'SESSION_TOO_LARGE'

  constructor(code: SessionError['code']) {
    super(code)
    this.name = 'SessionError'
    this.code = code
  }
}

function decodeKey(id: unknown, key: unknown): SessionKey {
  if (typeof id !== 'string' || !KEY_ID_PATTERN.test(id)) {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }

  const bytes = Buffer.from(key, 'base64url')
  if (bytes.byteLength !== 32) {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }
  const keyBytes = new Uint8Array(bytes.byteLength)
  keyBytes.set(bytes)
  return { id, bytes: keyBytes }
}

export function parseSessionKeyRing(raw: string): SessionKeyRing {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }

  const record = parsed as Record<string, unknown>
  if (!record.active || typeof record.active !== 'object') {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }
  const activeRecord = record.active as Record<string, unknown>
  const active = decodeKey(activeRecord.id, activeRecord.key)

  const keys = new Map<string, SessionKey>([[active.id, active]])
  if (record.previous !== undefined && record.previous !== null) {
    if (typeof record.previous !== 'object' || Array.isArray(record.previous)) {
      throw new SessionError('SESSION_CONFIG_INVALID')
    }
    const previousRecord = record.previous as Record<string, unknown>
    const previous = decodeKey(previousRecord.id, previousRecord.key)
    if (keys.has(previous.id)) {
      throw new SessionError('SESSION_CONFIG_INVALID')
    }
    keys.set(previous.id, previous)
  }

  return { active, byId: keys }
}

export function loadSessionKeyRing(env: ServerEnvironment): SessionKeyRing {
  if (!env.SESSION_KEYS) {
    throw new SessionError('SESSION_CONFIG_INVALID')
  }
  return parseSessionKeyRing(env.SESSION_KEYS)
}

function sessionAad(keyId: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(`${SESSION_COOKIE_NAME}:${SESSION_FORMAT_VERSION}:${keyId}`)
}

function isFiniteSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isSessionPayload(value: unknown): value is SessionPayloadV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  if (!payload.user || typeof payload.user !== 'object' || Array.isArray(payload.user)) {
    return false
  }
  const user = payload.user as Record<string, unknown>

  return (
    payload.version === 1 &&
    isFiniteSafeInteger(user.id) &&
    user.id > 0 &&
    typeof user.login === 'string' &&
    user.login.length > 0 &&
    user.login.length <= 100 &&
    typeof user.avatarUrl === 'string' &&
    user.avatarUrl.length <= 2_048 &&
    typeof payload.accessToken === 'string' &&
    payload.accessToken.length > 0 &&
    payload.accessToken.length <= 1_024 &&
    isFiniteSafeInteger(payload.accessTokenExpiresAt) &&
    typeof payload.refreshToken === 'string' &&
    payload.refreshToken.length > 0 &&
    payload.refreshToken.length <= 1_024 &&
    isFiniteSafeInteger(payload.refreshTokenExpiresAt) &&
    isFiniteSafeInteger(payload.issuedAt)
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

export async function sealSession(
  payload: SessionPayloadV1,
  keyRing: SessionKeyRing,
  iv: Uint8Array<ArrayBuffer> = Uint8Array.from(randomBytes(12)),
): Promise<string> {
  if (!isSessionPayload(payload) || iv.byteLength !== 12) {
    throw new SessionError('SESSION_INVALID')
  }

  const key = await importAesKey(keyRing.active, ['encrypt'])
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: sessionAad(keyRing.active.id),
      tagLength: 128,
    },
    key,
    textEncoder.encode(JSON.stringify(payload)),
  )
  const value = [
    SESSION_FORMAT_VERSION,
    keyRing.active.id,
    Buffer.from(iv).toString('base64url'),
    Buffer.from(encrypted).toString('base64url'),
  ].join('.')

  if (Buffer.byteLength(value, 'utf8') > SESSION_COOKIE_VALUE_MAX_BYTES) {
    throw new SessionError('SESSION_TOO_LARGE')
  }
  return value
}

export async function unsealSession(
  value: string,
  keyRing: SessionKeyRing,
): Promise<{ payload: SessionPayloadV1; needsRotation: boolean }> {
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== SESSION_FORMAT_VERSION) {
    throw new SessionError('SESSION_INVALID')
  }

  const [, keyId, encodedIv, encodedCiphertext] = parts
  if (!keyId || !encodedIv || !encodedCiphertext) {
    throw new SessionError('SESSION_INVALID')
  }
  const sessionKey = keyRing.byId.get(keyId)
  if (!sessionKey) throw new SessionError('SESSION_INVALID')

  try {
    const ivBuffer = Buffer.from(encodedIv, 'base64url')
    const ciphertextBuffer = Buffer.from(encodedCiphertext, 'base64url')
    if (ivBuffer.byteLength !== 12 || ciphertextBuffer.byteLength < 16) {
      throw new SessionError('SESSION_INVALID')
    }
    const iv = Uint8Array.from(ivBuffer)
    const ciphertext = Uint8Array.from(ciphertextBuffer)

    const key = await importAesKey(sessionKey, ['decrypt'])
    const decrypted = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: sessionAad(keyId),
        tagLength: 128,
      },
      key,
      ciphertext,
    )
    const payload: unknown = JSON.parse(textDecoder.decode(decrypted))
    if (!isSessionPayload(payload)) throw new SessionError('SESSION_INVALID')
    return { payload, needsRotation: keyId !== keyRing.active.id }
  } catch (error) {
    if (error instanceof SessionError) throw error
    throw new SessionError('SESSION_INVALID')
  }
}

export function sessionCookie(
  value: string,
  payload: SessionPayloadV1,
  now: number,
): string {
  const maxAge = Math.floor((payload.refreshTokenExpiresAt - now) / 1_000)
  if (maxAge <= 0) return clearSessionCookie()
  return serializeCookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  })
}

export function clearSessionCookie(): string {
  return clearHostCookie(SESSION_COOKIE_NAME)
}
