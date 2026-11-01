/**
 * 「当前是目标时区的第几分钟」——免打扰窗口这类按读者本地墙上时间判断的地方用它，
 * 调用方必须传入设置时区（主进程唯一提供者），不许再让 `Date.getHours()` 冒充本地时间。
 */
export function minutesOfDayInTimeZone(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return utcMinutesOfDay(now)
    return (hour % 24) * 60 + minute
  } catch {
    return utcMinutesOfDay(now)
  }
}

function utcMinutesOfDay(now: Date): number {
  return now.getUTCHours() * 60 + now.getUTCMinutes()
}
