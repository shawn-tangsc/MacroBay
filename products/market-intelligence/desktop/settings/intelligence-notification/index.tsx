import type { ReactElement } from 'react'

import { NotificationSettingsPanel } from './NotificationSettingsPanel'

/**
 * 设置 → 情报 → 通知（界面规范 v1.9 §8 版式、v2.39 §9d–§9f 内容）。
 *
 * 内容本身在 `NotificationSettingsPanel`：产品内「配置」抽屉显示的是**同一块实现**（用户
 * 2026-11-10：现成的挪进去），所以这里只剩设置页那一层外壳——页标题与页边距由面板按
 * `variant="page"` 自己给，本文件不再复制一份内容。
 */
export { MIGRATED_SETTING_KEYS, itemForFocus } from './NotificationSettingsPanel'

export default function IntelligenceNotificationSettingsSection(
  { focusEntityId }: Readonly<{ focusEntityId?: string | null }> = {}
): ReactElement {
  return <NotificationSettingsPanel focusEntityId={focusEntityId} variant="page" />
}
