import { expect, it } from 'vitest'
import type { ComponentProps } from 'react'

import type { EconomicCalendar } from './EconomicCalendar'

/**
 * 「日历设置」的去处是**页面必填**：旧看板抽屉已删，页面里不留第二条回退路。
 * 宿主必须自己决定落到哪（今天看板宿主传 `openConfigDrawer('sourcesData','calendar')`）。
 *
 * 这条是**编译期判据**：把 `onOpenSettings` 改回可选，下面那句 `@ts-expect-error` 就变成
 * 「未使用的指令」，`tsc` 当场红——比运行期用例更早拦住「又把回退塞回页面」。
 */
export function hostMustChooseTheDestination(withoutOpener: Omit<ComponentProps<typeof EconomicCalendar>, 'onOpenSettings'>): ComponentProps<typeof EconomicCalendar> {
  // @ts-expect-error 宿主必须给「设置」的去处，不传编译不过
  return withoutOpener
}

it('keeps the settings destination required at the type level', () => {
  expect(typeof hostMustChooseTheDestination).toBe('function')
})
