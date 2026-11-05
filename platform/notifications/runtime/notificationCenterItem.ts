/**
 * 记录 → 渲染层能看的那一份（落地约束 v1.2 §1）。
 *
 * 一句话：**句子在主进程解析，键与参数不出主进程**。渲染层拿不到 `titleKey`/`labelKey`，
 * `notification.event.…` 这种串在结构上就印不到屏幕上——不靠评审记得，也不靠黑名单拦。
 *
 * 两件事在这份投影里刻意**不跟着文案走**：
 * - `category`（类型标签）与 `createdAt`（发生时间）是结构字段，文案解析失败、整条降级成兜底句时
 *   它们照旧在。否则「点开看详情」只剩一句兜底句，等于点了没反应。
 * - `safeMetadata` 仍然过一遍脱敏（`toSafeNotificationRecord`），投影不绕过那道口子。
 */
import {
  toSafeNotificationRecord,
  type NotificationCenterAction,
  type NotificationCenterItem,
  type NotificationRecord
} from '../contracts/notificationContracts'
import type { NotificationCategory } from '../contracts/notificationEventCatalog'
import type { NotificationDeliveryContent } from './notificationRouting'

export function toNotificationCenterItem(
  record: NotificationRecord,
  content: NotificationDeliveryContent,
  category: NotificationCategory | undefined
): NotificationCenterItem {
  const safe = toSafeNotificationRecord(record)
  const {
    titleKey,
    titleParams,
    bodyKey,
    bodyParams,
    reasonKey,
    reasonParams,
    actions,
    ...rest
  } = safe

  // 解析不出标签的动作整条不出现：按钮上印 `notification.…` 比没有按钮更糟。
  const labelled = actions.flatMap((action): NotificationCenterAction[] => {
    const label = content.actionLabels[action.id]
    if (label === undefined) return []
    const { labelKey, ...actionRest } = action
    return [{ ...actionRest, label }]
  })

  return {
    ...rest,
    title: content.title,
    body: content.body,
    ...(content.reason.length === 0 ? {} : { reason: content.reason }),
    actions: labelled,
    ...(category === undefined ? {} : { category })
  }
}
