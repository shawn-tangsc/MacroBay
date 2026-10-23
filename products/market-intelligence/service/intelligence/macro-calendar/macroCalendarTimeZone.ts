export const macroCalendarTimeZonePolicy = {
  officialEasternTimeZone: 'America/New_York',
  localTimePattern: /^(\d{2}):(\d{2})$/,
  localDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const

export function toUtcIsoFromOfficialEasternTime(date: string, time: string): string | undefined {
  if (!macroCalendarTimeZonePolicy.localDatePattern.test(date)) return undefined
  const match = macroCalendarTimeZonePolicy.localTimePattern.exec(time)
  if (!match) return undefined
  const [year, month, day] = date.split('-').map(Number)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!isCalendarTime(year, month, day, hour, minute)) return undefined
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute)
  const offset = easternOffsetAt(new Date(naiveUtc))
  if (offset === undefined) return undefined
  const instant = new Date(naiveUtc - offset)
  return easternParts(instant).date === date && easternParts(instant).time === time ? instant.toISOString() : undefined
}

function easternOffsetAt(date: Date): number | undefined {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: macroCalendarTimeZonePolicy.officialEasternTimeZone, timeZoneName: 'shortOffset' })
    .formatToParts(date).find((part) => part.type === 'timeZoneName')?.value
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset ?? '')
  if (!match) return undefined
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
  return match[1] === '+' ? minutes * 60_000 : -minutes * 60_000
}

function easternParts(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: macroCalendarTimeZonePolicy.officialEasternTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
}

function isCalendarTime(year: number, month: number, day: number, hour: number, minute: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day && hour < 24 && minute < 60
}
