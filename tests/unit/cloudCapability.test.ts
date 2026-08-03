import { describe, expect, it } from 'vitest'
import {
  CLOUD_PRODUCTION_ORIGINS,
  resolveCloudCapability,
} from '../../src/lib/cloudCapability'

describe('cloud capability', () => {
  it.each(CLOUD_PRODUCTION_ORIGINS)(
    'enables only an exact Production Origin when the flag is on: %s',
    (origin) => {
      expect(resolveCloudCapability(origin, true)).toBe('enabled')
    },
  )

  it.each([
    'https://branch-git-feature.vercel.app',
    'http://localhost:5173',
    'https://mkb.bamboosato.com.evil.test',
  ])('keeps Preview, localhost, and suffix lookalikes local-only: %s', (origin) => {
    expect(resolveCloudCapability(origin, true)).toBe('local-only')
  })

  it('keeps Production local-only while the rollout flag is off', () => {
    expect(resolveCloudCapability(CLOUD_PRODUCTION_ORIGINS[0], false)).toBe(
      'local-only',
    )
  })
})
