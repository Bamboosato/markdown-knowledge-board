import { randomUUID } from 'node:crypto'

export type ApiStage =
  | 'auth-check'
  | 'auth-callback'
  | 'backup-discovery'
  | 'backup-upload'
  | 'restore-download'

export type ApiSuccess<T> = {
  ok: true
  data: T
  requestId: string
}

export type ApiError = {
  ok: false
  error: {
    code: string
    message: string
    retryable: boolean
    stage?: ApiStage
    retryAfterSeconds?: number
  }
  requestId: string
}

export function createRequestId(): string {
  return randomUUID()
}

function responseHeaders(requestId: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('X-Request-Id', requestId)
  return headers
}

export function apiSuccess<T>(
  data: T,
  requestId: string,
  init: Omit<ResponseInit, 'headers'> & { headers?: HeadersInit } = {},
): Response {
  const body: ApiSuccess<T> = { ok: true, data, requestId }
  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status ?? 200,
    headers: responseHeaders(requestId, init.headers),
  })
}

export function apiError(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  requestId: string,
  options: {
    stage?: ApiStage
    retryAfterSeconds?: number
    headers?: HeadersInit
  } = {},
): Response {
  const body: ApiError = {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(options.stage ? { stage: options.stage } : {}),
      ...(options.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: options.retryAfterSeconds }
        : {}),
    },
    requestId,
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(requestId, options.headers),
  })
}

export function methodNotAllowed(
  allowed: readonly string[],
  requestId: string,
): Response {
  return apiError(
    405,
    'METHOD_NOT_ALLOWED',
    'This HTTP method is not supported.',
    false,
    requestId,
    { headers: { Allow: allowed.join(', ') } },
  )
}
