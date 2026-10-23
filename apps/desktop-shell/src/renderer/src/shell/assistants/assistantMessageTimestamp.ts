import type { AppLanguage } from '@platform/settings/schema/appSettings'

export function formatAssistantMessageTimestamp(
  createdAt: string,
  language: AppLanguage,
  now = new Date()
): string | null {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null

  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US'
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const format: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }

  return new Intl.DateTimeFormat(locale, format).format(date)
}
