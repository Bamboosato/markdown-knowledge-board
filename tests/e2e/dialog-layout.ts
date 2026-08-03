import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

export async function expectNoHorizontalOverflow(
  dialog: Locator,
  intent: string,
) {
  const dimensions = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))

  expect(
    dimensions.scrollWidth,
    `${intent}: dialog content must fit within ${dimensions.clientWidth}px`,
  ).toBeLessThanOrEqual(dimensions.clientWidth)
}
