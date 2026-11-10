import type { ReactElement } from 'react'

import { NotificationDrawerScreen } from './NotificationDrawerScreen'
import { NotificationPageScreen } from './NotificationPageScreen'

/**
 * 通知这一屏的入口：**两个面各自一份实现**（用户 2026-11-10 定，抽屉形状与设置页形状互不绑架）。
 *
 * - 抽屉：`NotificationDrawerScreen` —— 单列区块（推送提醒 / 舆情条件 / 日历提醒）；
 * - 设置页：`NotificationPageScreen` —— 保留原两栏与 860 断点，C9 收口时再处理。
 *
 * 这里只做路由，不持有任何内容；下面的再导出是设置页与用例在用的两样。
 */
export { itemForFocus } from './NotificationPageScreen'
export { MIGRATED_SETTING_KEYS } from './NotificationPageScreen'

export function NotificationSettingsPanel({ focusEntityId, variant = 'drawer' }: Readonly<{
  focusEntityId?: string | null
  variant?: 'page' | 'drawer'
}>): ReactElement {
  return variant === 'page'
    ? <NotificationPageScreen focusEntityId={focusEntityId} />
    : <NotificationDrawerScreen />
}
