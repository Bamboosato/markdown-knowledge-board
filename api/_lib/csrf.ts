import { randomBytes, timingSafeEqual } from 'node:crypto'
import { parseCookies, serializeCookie } from './cookies.js'
import { findOriginConfig } from './origins.js'

export const CSRF_COOKIE_NAME = '__Host-mkb_csrf'
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type CsrfValidationResult =
  | { ok: true }
  | { ok: false; code: 'ORIGIN_MISMATCH' | 'CSRF_INVALID' }

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

export function csrfCookie(token: string): string {
  return serializeCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
  })
}

export function getOrCreateCsrfToken(request: Request): {
  token: string
  setCookie: string | null
} {
  const current = parseCookies(request.headers.get('Cookie')).get(CSRF_COOKIE_NAME)
  if (current && CSRF_TOKEN_PATTERN.test(current)) {
    return { token: current, setCookie: null }
  }

  const token = createCsrfToken()
  return { token, setCookie: csrfCookie(token) }
}

export function validateStateChangingRequest(
  request: Request,
): CsrfValidationResult {
  const requestOrigin = findOriginConfig(request.url)
  const headerOrigin = request.headers.get('Origin')
  if (!requestOrigin || headerOrigin !== requestOrigin.origin) {
    return { ok: false, code: 'ORIGIN_MISMATCH' }
  }

  const cookieToken = parseCookies(request.headers.get('Cookie')).get(
    CSRF_COOKIE_NAME,
  )
  const headerToken = request.headers.get(CSRF_HEADER_NAME)
  if (
    !cookieToken ||
    !headerToken ||
    !CSRF_TOKEN_PATTERN.test(cookieToken) ||
    !CSRF_TOKEN_PATTERN.test(headerToken)
  ) {
    return { ok: false, code: 'CSRF_INVALID' }
  }

  const cookieBytes = Buffer.from(cookieToken, 'ascii')
  const headerBytes = Buffer.from(headerToken, 'ascii')
  return timingSafeEqual(cookieBytes, headerBytes)
    ? { ok: true }
    : { ok: false, code: 'CSRF_INVALID' }
}
