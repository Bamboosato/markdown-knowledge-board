import { describe, expect, it } from 'vitest'
import { cloudBackupCompletedMessage } from '../../src/lib/cloudBackupNotice'

describe('cloudBackupCompletedMessage', () => {
  it.each([
    [
      0,
      'Cloud backup completed. The encrypted backup contains no notes.',
    ],
    [
      1,
      'Cloud backup completed. 1 note was encrypted and saved to GitHub.',
    ],
    [
      21,
      'Cloud backup completed. 21 notes were encrypted and saved to GitHub.',
    ],
  ] as const)('formats the completion message for %i notes', (count, expected) => {
    expect(cloudBackupCompletedMessage(count)).toBe(expected)
  })
})
