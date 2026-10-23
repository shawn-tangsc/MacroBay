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

  for (let attempt = 0; attempt < maxCronSearchAttempts; attempt += 1) {
    if (matchesCronExpression(parsed, cursor, timezone)) {
      return cursor.getTime()
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0)
  }

  return null
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

function matchesCronExpression(expr: ParsedCronExpression, date: Date, timezone: string | undefined): boolean {
  const dateParts = getCronDateParts(date, timezone)
  if (!dateParts) return false

  return (
    matchesCronField(expr.minute, dateParts.minute) &&
    matchesCronField(expr.hour, dateParts.hour) &&
    matchesCronField(expr.dayOfMonth, dateParts.dayOfMonth) &&
    matchesCronField(expr.month, dateParts.month) &&
    matchesCronField(expr.dayOfWeek, dateParts.dayOfWeek)
  )
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
