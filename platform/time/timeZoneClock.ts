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

export type WallClockComponents = {
  timeZone: string
  year: number
  month: number
  day: number
  hour: number
  minute?: number
}

/**
 * 墙上时间 → 瞬时（该时区里 `year-month-day hour:minute` 对应的那一刻）。
 *
 * 用 `Intl` 反查偏移，不写 DST 表（各国的规则历史上改过多次），也不用 `Temporal`（运行时没有）。
 * 两步收敛：把墙上时间当 UTC 得 `t0` → 取该时区相对 UTC 的偏移 → `t = t0 - offset`，偏移若变再收敛一次。
 *
 * - **不存在**（春季跳过）：返回空隙之后的第一个瞬时——往前提会读到开盘前的数据。
 * - **重复**（秋季回拨）：返回较早的那个瞬时——开盘只发生一次，取晚的等于晚一小时分析。
 * - **失败即关闭**：tz 非法、`Intl` 抛错、校验不过一律返回 `null`；不许退回 UTC 或机器时区，
 *   那是拿错时段的行情去开一次模型调用，比不跑更糟。
 */
export function instantForWallClock(input: WallClockComponents): Date | null {
  const minute = input.minute ?? 0
  try {
    const t0 = Date.UTC(input.year, input.month - 1, input.day, input.hour, minute)
    if (!Number.isFinite(t0)) return null

    const candidates = new Set<number>()
    let guess = t0
    for (let round = 0; round < 3; round += 1) {
      const offset = offsetMinutesAt(guess, input.timeZone)
      if (offset === null) return null
      guess = t0 - offset * 60_000
      candidates.add(guess)
    }

    const valid = [...candidates].filter((instant) => matchesWallClock(instant, input))
    if (valid.length > 0) return new Date(Math.min(...valid))

    // 没有任何候选落在请求的墙上时间上：这是春季跳过的空隙，取空隙之后的第一个瞬时。
    const earliest = Math.min(...candidates)
    for (let delta = 60_000; delta <= 4 * 60 * 60_000; delta += 60_000) {
      const instant = earliest + delta
      const wall = wallClockAt(instant, input.timeZone)
      if (wall === null) continue
      if (compareWallClock(wall, input) >= 0) return new Date(instant)
    }
    return null
  } catch {
    return null
  }
}

type WallClockAt = { year: number; month: number; day: number; hour: number; minute: number }

function offsetMinutesAt(instantMs: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(instantMs))
    const zoneName = parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    if (zoneName === 'GMT' || zoneName === 'UTC') return 0
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zoneName)
    if (!match) return null
    const sign = match[1] === '-' ? -1 : 1
    const hours = Number(match[2])
    const minutes = Number(match[3] ?? 0)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    return sign * (hours * 60 + minutes)
  } catch {
    return null
  }
}

function wallClockAt(instantMs: number, timeZone: string): WallClockAt | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(instantMs))
    const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 'NaN')
    const wall = { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') }
    return Number.isFinite(wall.year) && Number.isFinite(wall.month) && Number.isFinite(wall.day) &&
      Number.isFinite(wall.hour) && Number.isFinite(wall.minute)
      ? wall
      : null
  } catch {
    return null
  }
}

function matchesWallClock(instantMs: number, input: WallClockComponents): boolean {
  const wall = wallClockAt(instantMs, input.timeZone)
  if (wall === null) return false
  return compareWallClock(wall, input) === 0
}

function compareWallClock(wall: WallClockAt, input: WallClockComponents): number {
  const requested = [input.year, input.month, input.day, input.hour, input.minute ?? 0]
  const actual = [wall.year, wall.month, wall.day, wall.hour, wall.minute]
  for (let index = 0; index < requested.length; index += 1) {
    if (actual[index] !== requested[index]) return actual[index] - requested[index]
  }
  return 0
}
