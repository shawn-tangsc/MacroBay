import type { CalendarLandedFilter, CalendarReminderLeadMinutes } from '../../../contracts/calendarEventReminder'
import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'

/**
 * 值 → 文案键的静态表。
 *
 * 为什么不在调用点拼 `pages...leads.${minutes}`：拼出来的键**没法被静态检查**，写错一个字符
 * 界面上就直接露出裸键名，而不是报错。守卫（`choiceKeyGuard`）因此只认字面量键；这张表把
 * 每个字面量写在一处，类型再把「值」与「键」钉在一起——漏一档编译不过，多一档也看得见。
 */
export const CALENDAR_REMINDER_LEAD_KEYS = {
  15: 'pages.intelligence.notification.leads.15',
  30: 'pages.intelligence.notification.leads.30',
  60: 'pages.intelligence.notification.leads.60',
  120: 'pages.intelligence.notification.leads.120'
} as const satisfies Readonly<Record<CalendarReminderLeadMinutes, string>>

export const CALENDAR_LANDED_FILTER_KEYS = {
  'surprise-only': 'pages.intelligence.notification.landed.surprise-only',
  'also-matched': 'pages.intelligence.notification.landed.also-matched'
} as const satisfies Readonly<Record<CalendarLandedFilter, string>>

export const NEWS_PUSH_THRESHOLD_KEYS = {
  high: 'pages.intelligence.notification.threshold.high',
  medium: 'pages.intelligence.notification.threshold.medium',
  low: 'pages.intelligence.notification.threshold.low'
} as const satisfies Readonly<Record<NewsSentimentTierThreshold, string>>
