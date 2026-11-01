type ParsedCronField = {
  any: boolean
  values: Set<number>
}

type ParsedCronExpression = {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

const maxCronSearchAttempts = 525_600
const weekdayByLabel: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
}
const formatterByTimezone = new Map<string, Intl.DateTimeFormat>()

export function computeNextCronRunAt(
  expression: string,
  timezone: string | undefined,
  startMs: number
): number | null {
  if (!Number.isFinite(startMs) || !Number.isSafeInteger(startMs) || Math.abs(startMs) > 8_640_000_000_000_000) return null
  if (timezone && !getFormatterForTimezone(timezone)) return null
  const parsed = parseCronExpression(expression)
  if (!parsed) return null

  const cursor = new Date(startMs)
  if (cursor.getUTCSeconds() !== 0 || cursor.getUTCMilliseconds() !== 0) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0)
  } else {
    cursor.setUTCSeconds(0, 0)
  }

  // Walk candidates coarsest field first, and jump to the next hour whenever one of the calendar or
  // hour fields cannot match. That is exact — every minute of an hour shares those fields — and it
  // keeps a dead expression within the same 365-day window at ~8.7k timezone lookups instead of
  // 525,600. The minute-by-minute version spent ~21 s of main-process time on `0 0 29 2 *`, and the
  // settings projection calls this for every registered definition, synchronously, on every refresh.
  let remainingMinutes = maxCronSearchAttempts
  while (remainingMinutes > 0) {
    const parts = getCronDateParts(cursor, timezone)
    if (!parts) return null

    if (
      !matchesCronField(parsed.month, parts.month) ||
      !matchesCronField(parsed.dayOfMonth, parts.dayOfMonth) ||
      !matchesCronField(parsed.dayOfWeek, parts.dayOfWeek) ||
      !matchesCronField(parsed.hour, parts.hour)
    ) {
      remainingMinutes -= advanceToNextHour(cursor)
      continue
    }
    if (!matchesCronField(parsed.minute, parts.minute)) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0)
      remainingMinutes -= 1
      continue
    }

    return cursor.getTime()
  }

  return null
}

/** Advances the cursor to the next hour boundary and returns how many minutes that consumed. */
function advanceToNextHour(cursor: Date): number {
  const minutesToNextHour = 60 - cursor.getUTCMinutes()
  cursor.setUTCMinutes(cursor.getUTCMinutes() + minutesToNextHour, 0, 0)
  return minutesToNextHour
}

function parseCronExpression(expr: string): ParsedCronExpression | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const parsedMinute = parseCronField(minute, 0, 59)
  const parsedHour = parseCronField(hour, 0, 23)
  const parsedDayOfMonth = parseCronField(dayOfMonth, 1, 31)
  const parsedMonth = parseCronField(month, 1, 12)
  const parsedDayOfWeek = parseCronField(dayOfWeek, 0, 6)
  if (!parsedMinute || !parsedHour || !parsedDayOfMonth || !parsedMonth || !parsedDayOfWeek) {
    return null
  }

  return {
    minute: parsedMinute,
    hour: parsedHour,
    dayOfMonth: parsedDayOfMonth,
    month: parsedMonth,
    dayOfWeek: parsedDayOfWeek
  }
}

function parseCronField(input: string, min: number, max: number): ParsedCronField | null {
  if (input === '*') {
    return { any: true, values: new Set<number>() }
  }

  const values = new Set<number>()
  for (const segment of input.split(',')) {
    if (!segment) return null
    if (segment.includes('/')) {
      const [rangePart, stepPart] = segment.split('/')
      const step = Number(stepPart)
      if (!Number.isInteger(step) || step <= 0) return null
      const range = parseCronRange(rangePart, min, max)
      if (!range) return null
      for (let value = range.start; value <= range.end; value += step) {
        values.add(value)
      }
      continue
    }

    const range = parseCronRange(segment, min, max)
    if (!range) return null
    for (let value = range.start; value <= range.end; value += 1) {
      values.add(value)
    }
  }

  return { any: false, values }
}

function parseCronRange(input: string, min: number, max: number): { start: number; end: number } | null {
  if (input === '*') {
    return { start: min, end: max }
  }
  if (input.includes('-')) {
    const [startText, endText] = input.split('-')
    const start = Number(startText)
    const end = Number(endText)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      return null
    }
    return { start, end }
  }

  const value = Number(input)
  if (!Number.isInteger(value) || value < min || value > max) return null
  return { start: value, end: value }
}

function matchesCronField(field: ParsedCronField, value: number): boolean {
  return field.any || field.values.has(value)
}

function getCronDateParts(
  date: Date,
  timezone: string | undefined
): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } | null {
  if (!timezone) {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay()
    }
  }

  const formatter = getFormatterForTimezone(timezone)
  if (!formatter) return null

  const parts = formatter.formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const minute = Number(values.minute)
  const hour = Number(values.hour)
  const dayOfMonth = Number(values.day)
  const month = Number(values.month)
  const dayOfWeek = weekdayByLabel[values.weekday ?? '']

  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(dayOfMonth) ||
    !Number.isInteger(month) ||
    !Number.isInteger(dayOfWeek)
  ) {
    return null
  }

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek
  }
}

function getFormatterForTimezone(timezone: string): Intl.DateTimeFormat | null {
  const existing = formatterByTimezone.get(timezone)
  if (existing) return existing

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    formatterByTimezone.set(timezone, formatter)
    return formatter
  } catch {
    return null
  }
}
