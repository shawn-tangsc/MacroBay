import type { NotificationContentByLanguage } from '@platform/notifications/contracts/notificationContracts'

import type { CalendarReminderCandidate } from './calendarEventReminderScan'

/**
 * 「日历事件开始前」那条通知的成品句子（契约 v2.56：源头拼、平台只挑一份）。
 *
 * 三件事写死在这里：
 * - **分钟数是实际剩余**（候选里算好的），不是配置的提前档——补发那条尤其不能写「60 分钟后」；
 * - **时刻按读者时区显示**，判断却只认 UTC：改时区只改显示，不改「什么时候到点」；
 * - **不写动作指令**（「点开」「查看」这类）：手机上是一条纯文本，动作由界面按钮承担。
 */

const IMPORTANCE_WORD = Object.freeze({
  'zh-CN': { high: '高', medium: '中', low: '低' },
  'en-US': { high: 'High', medium: 'Medium', low: 'Low' }
} as const)

/** `11/07 21:30`：短、带日期，跨零点时不会只看到一个时间。 */
export function formatCalendarReminderInstant(instant: string, language: 'zh-CN' | 'en-US', timeZone: string): string {
  const at = new Date(instant)
  if (!Number.isFinite(at.getTime())) return instant
  try {
    return new Intl.DateTimeFormat(language, {
      timeZone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(at)
  } catch {
    // 时区不可用：宁可给出 UTC 读数，也不要抛——提醒的内容比格式化精度重要。
    return new Intl.DateTimeFormat(language, { timeZone: 'UTC', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  }
}

export type CalendarReminderSentenceInput = Readonly<{
  candidate: CalendarReminderCandidate
  /** 读者设置时区（IANA）。只影响显示。 */
  timeZone: string
}>

export function renderCalendarReminderSentence(
  input: CalendarReminderSentenceInput
): NotificationContentByLanguage {
  const timeOf = (language: 'zh-CN' | 'en-US') =>
    formatCalendarReminderInstant(input.candidate.scheduledAt, language, input.timeZone)

  return {
    'zh-CN': {
      title: `${input.candidate.title} ${input.candidate.remainingMinutes} 分钟后开始`,
      body: `${timeOf('zh-CN')} 开始 · 重要性${IMPORTANCE_WORD['zh-CN'][input.candidate.importance]}`,
      reason: '你打开了日历事件的开始前提醒。'
    },
    'en-US': {
      title: `${input.candidate.title} starts in ${input.candidate.remainingMinutes} min`,
      body: `Starts ${timeOf('en-US')} · ${IMPORTANCE_WORD['en-US'][input.candidate.importance]} importance`,
      reason: 'You turned on the reminder before calendar events start.'
    }
  }
}
