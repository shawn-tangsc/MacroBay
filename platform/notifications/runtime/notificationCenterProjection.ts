import { notificationCopyText, type NotificationCopyLanguage } from '../../i18n/notificationCopy'
import type {
  NotificationCategory
} from '../contracts/notificationEventCatalog'
import type { NotificationCenterItem, NotificationRecord } from '../contracts/notificationContracts'
import { toNotificationCenterItem } from './notificationCenterItem'
import { posterEvidenceOf, type PosterChannelCapability } from './notificationPosterEvidence'
import type { NotificationDeliveryContent } from './notificationRouting'

/**
 * 记录 → 中心条目（从 `notificationRuntime.ts` 抽出来：那个文件贴着 500 行上限）。
 *
 * 两件事在这里定：
 * - **手机为什么没发出去**的那一句只给一种处境：一条可用通道都没有（`failed` + `push-unavailable`）。
 *   别的原因各有逐通道结果，逐行展示等界面设计定稿；复用这句会把读者指到错误的方向。
 * - 句子在主进程解析（与标题同一条口径），渲染层拿到的就是这句话。
 */
export async function projectNotificationCenterItem(input: {
  record: NotificationRecord
  /** 投递路径上刚解析过的正文：直接传进来，不解析第二遍（否则同一屏可能两种说法）。 */
  content: NotificationDeliveryContent
  category: NotificationCategory | undefined
  language: () => Promise<NotificationCopyLanguage>
  /** 通道的显示名与图片能力（分母只数支持图片的）：由组合根注入，缺省时这一行按「不支持」计。 */
  channelCapability?: PosterChannelCapability
}): Promise<NotificationCenterItem> {
  const push = input.record.delivery.push
  const deliveryHint = push?.state === 'failed' && push.reason === 'push-unavailable'
    ? notificationCopyText(await input.language(), 'notification.deliveryReason.pushUnavailable')
    : undefined
  return toNotificationCenterItem(
    input.record,
    input.content,
    input.category,
    deliveryHint,
    posterEvidenceOf(input.record, input.channelCapability)
  )
}
