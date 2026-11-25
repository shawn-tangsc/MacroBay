import type { NotificationCenterItem, NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationCategory } from '../contracts/notificationEventCatalog'
import type { NotificationCopyLanguage } from '../../i18n/notificationCopy'
import type { NotificationDeliveryContent } from './notificationRouting'
import { projectNotificationCenterItem } from './notificationCenterProjection'
import type { PosterChannelCapability } from './notificationPosterEvidence'

/**
 * 「一条记录给渲染层的样子」这一个入口（#46 之后从 `notificationRuntime.ts` 抽出来：
 * 那份文件贴着 500 行线）。
 *
 * 只有一条口径：**投递路径上正文刚解析过就原样传进来**，不解析第二遍——同一屏出现两种说法
 * 比难看严重得多。海报那一行（#46）也在这一个投影里，列表与详情不各查一遍。
 */
export function createNotificationCenterReader(input: Readonly<{
  resolveContent: (record: NotificationRecord) => Promise<NotificationDeliveryContent>
  categoryOf: (record: NotificationRecord) => NotificationCategory | undefined
  language: () => Promise<NotificationCopyLanguage>
  channelCapability?: PosterChannelCapability
}>): (record: NotificationRecord, content?: NotificationDeliveryContent) => Promise<NotificationCenterItem> {
  return async (record, content) => projectNotificationCenterItem({
    record,
    content: content ?? await input.resolveContent(record),
    category: input.categoryOf(record),
    language: input.language,
    ...(input.channelCapability === undefined ? {} : { channelCapability: input.channelCapability })
  })
}
