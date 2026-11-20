import type { NotificationEventDeclaration } from '../../../platform/notifications/contracts/notificationEventCatalog'
import {
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '../../../platform/notifications/contracts/platformNotificationEvents'

/**
 * 声明一条产品通知事件：**键由 id 机械生成**（平台同一处 `notification.event.<id>.*`）。
 *
 * 不手写键的理由：事件改名时手写的键不会有人同步，目录解析出来就落空——同一个概念两个名字，
 * 接线时才发现。
 *
 * 从 `product.manifest.ts` 抽出来（2026-11-18）：那个文件已经越过 500 行门禁，新事件不该再往里堆。
 * 装配端仍从 manifest 读 `notificationEvents`，这里只是把「一条声明怎么写」变成一处。
 */
export function notificationEvent(
  id: string,
  input: Omit<NotificationEventDeclaration, 'id' | 'titleKey' | 'reasonKey' | 'bodyKey' | 'bodyKeyByVariant'> & {
    /** 这条事件有正文句（`…body`）。 */
    body?: boolean
    /** 同一事件两种正文时给变体名，键为 `…body.<variant>`。 */
    bodyVariants?: readonly string[]
  }
): NotificationEventDeclaration {
  const { body, bodyVariants, ...rest } = input
  return {
    id,
    titleKey: notificationEventTitleKey(id),
    reasonKey: notificationEventReasonKey(id),
    ...(body ? { bodyKey: notificationEventBodyKey(id) } : {}),
    ...(bodyVariants
      ? { bodyKeyByVariant: Object.fromEntries(bodyVariants.map((variant) => [variant, notificationEventBodyKey(id, variant)])) }
      : {}),
    ...rest
  }
}
