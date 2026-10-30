/** The month a meeting falls in, named the way the row's label needs it. */
export function policyPathMonth(meetingDate: string, locale: 'zh-CN' | 'en-US'): string {
  const month = Number(meetingDate.slice(5, 7))
  if (!Number.isInteger(month) || month < 1 || month > 12) return ''
  return locale === 'zh-CN' ? String(month) : new Date(Date.UTC(2026, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
}
