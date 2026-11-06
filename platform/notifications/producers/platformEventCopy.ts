/**
 * 平台自己的事件在**源头**拼成品句子（契约 v2.56 责任边界）。
 *
 * 平台的 9 条事件也是「源头」之一：它知道这次发生了什么事、手里有名字与数字，所以由它拼，
 * 通知运行时只负责「按读者语言挑一份发出去」。这条 helper 是平台侧唯一拼句入口，
 * 措辞仍来自 `notificationCopy`（一处文案表），这里只负责把事实填进骨架、两种语言各出一份。
 *
 * 拼不出成品就返回 `undefined`：调用方**不提交**——源头没拼完的东西不该进记录
 * （回执 `rejected: copy-missing` 是给漏网的提交兜底的，不该被平台自己踩到）。
 */
import { notificationCopy, resolveNotificationCopyText, type NotificationCopyLanguage } from '../../i18n/notificationCopy'
import type { NotificationContentByLanguage } from '../contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'

export type PlatformEventCopyInput = {
  eventTypeId: string
  /** 两种语言相同的参数（频道名、供应商名这类本来就与语言无关的事实）。 */
  params?: Readonly<Record<string, string>>
  /** 按语言不同的参数（例如作业名的中英两份）。给了就覆盖同名的 `params`。 */
  paramsByLanguage?: Partial<Record<NotificationCopyLanguage, Readonly<Record<string, string>>>>
  /** 正文变体（声明里 `bodyKeyByVariant` 的键）。 */
  bodyVariant?: string
}

export function renderPlatformEventCopy(input: PlatformEventCopyInput): NotificationContentByLanguage | undefined {
  const declaration = PLATFORM_NOTIFICATION_EVENTS.find((event) => event.id === input.eventTypeId)
  if (declaration === undefined) return undefined

  const bodyKey = input.bodyVariant === undefined
    ? declaration.bodyKey
    : declaration.bodyKeyByVariant?.[input.bodyVariant]
  if (bodyKey === undefined) return undefined

  const fill = (language: NotificationCopyLanguage, key: string): string | undefined => {
    const template = notificationCopy[language][key as keyof typeof notificationCopy[typeof language]]
    if (typeof template !== 'string' || template.trim().length === 0) return undefined
    const params = { ...input.params, ...input.paramsByLanguage?.[language] }
    // 源头拼的时候一定带着值，所以可选段在这里按「必填」处理：`{taskName?}` → `{taskName}`。
    const required = template.replace(/\{(\w+)\?\}/gu, '{$1}')
    const filled = resolveNotificationCopyText(language, required, params)
    // 参数缺失时占位符会留下——那说明源头没把事实备齐，不许交给平台。
    return /\{\w+\}/u.test(filled) ? undefined : filled
  }

  const build = (language: NotificationCopyLanguage): { title: string; body: string; reason: string } | undefined => {
    const title = fill(language, declaration.titleKey)
    const body = fill(language, bodyKey)
    const reason = fill(language, declaration.reasonKey)
    if (title === undefined || body === undefined || reason === undefined) return undefined
    return { title, body, reason }
  }

  const zh = build('zh-CN')
  const en = build('en-US')
  if (zh === undefined || en === undefined) return undefined
  return { 'zh-CN': zh, 'en-US': en }
}
