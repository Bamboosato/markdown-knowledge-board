import { apiError } from './http.js'
import { findOriginConfig, type OriginConfig } from './origins.js'

export type ServerEnvironment = Readonly<
  Partial<Record<string, string | undefined>>
>

export type ProductionGateResult =
  | { ok: true; origin: OriginConfig }
  | { ok: false; response: Response }

export function requireProductionCloudEnvironment(
  request: Request,
  requestId: string,
  env: ServerEnvironment,
): ProductionGateResult {
  const origin = findOriginConfig(request.url)

  if (env.VERCEL_ENV !== 'production' || !origin) {
    return {
      ok: false,
      response: apiError(
        404,
        'CLOUD_NOT_AVAILABLE',
        'Cloud features are not available in this environment.',
        false,
        requestId,
      ),
    }
  }

  return { ok: true, origin }
}
