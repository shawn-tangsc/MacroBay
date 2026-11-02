/**
 * 文案键存在性门禁（产品经理 2026-11-03 提，比等文案更要紧的那条）。
 *
 * 「键非空」只挡住手滑，挡不住**键存在但文案还没写**：那种事件在界面上会直接显示键名
 * （`notification.event.platform.job.failed-terminal.title`），而且不红、不报错，只是被人看见。
 * 所以判据是：每条声明的 `titleKey` / `reasonKey` 在**中英两套文案**里都能查到非空句子。
 *
 * 本模块只做判定，不认识任何具体文案表：调用方把「按语言 + 键查句子」的端口传进来，
 * 平台事件用 `notificationCopy`，产品事件用各自的文案表。这样平台不 import 产品代码。
 */
export type NotificationEventCopyLanguage = 'zh-CN' | 'en-US'

/** 查一句文案；键不存在返回 `undefined`（空串按缺失算，见下）。 */
export type NotificationEventCopyLookup = (language: NotificationEventCopyLanguage, key: string) => string | undefined

export type NotificationEventCopyGap = {
  eventTypeId: string
  key: string
  language: NotificationEventCopyLanguage
}

const LANGUAGES: readonly NotificationEventCopyLanguage[] = ['zh-CN', 'en-US']

/**
 * 找出所有缺失的文案键。空串也算缺失——文案表里留一个占位空句，界面就是一片空白，
 * 和缺键一样看不见原因。
 */
export function findMissingNotificationEventCopy(
  events: readonly { id: string; titleKey: string; reasonKey: string }[],
  lookup: NotificationEventCopyLookup
): NotificationEventCopyGap[] {
  const gaps: NotificationEventCopyGap[] = []
  for (const event of events) {
    for (const key of [event.titleKey, event.reasonKey]) {
      for (const language of LANGUAGES) {
        const text = lookup(language, key)
        if (typeof text !== 'string' || text.trim() === '') {
          gaps.push({ eventTypeId: event.id, key, language })
        }
      }
    }
  }
  return gaps
}

/** 门禁形态：缺一条就抛，消息里带事件 id、键与语言——红的时候唯一被读的就是这句话。 */
export function assertNotificationEventCopy(
  events: readonly { id: string; titleKey: string; reasonKey: string }[],
  lookup: NotificationEventCopyLookup
): void {
  const gaps = findMissingNotificationEventCopy(events, lookup)
  if (gaps.length === 0) return
  const described = gaps.map((gap) => `${gap.eventTypeId} ${gap.language} ${gap.key}`).join('; ')
  throw new Error(`notification-event-copy-missing: ${described}`)
}
