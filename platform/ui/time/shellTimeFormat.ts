import { fallbackTimeZone, systemTimeZoneSetting, type TimeZoneSetting } from '../../settings/schema/appSettings'

/**
 * Owner: platform/ui/time（平台时间显示口径）。
 *
 * 产品的存储、IPC 与快照一律是规范 UTC 瞬时（`…Z`）。展示时如果写死 UTC，用户会看到与自己相差一个时区
 * 的时刻（真机症状：中国用户看到 `2026-10-09 03:39 UTC`，本地其实是 11:39）。这里提供**唯一**的读取
 * 口径：一个已解析的 IANA 时区 id → `YYYY-MM-DD HH:mm[:ss] GMT±n`。
 *
 * 只用 `Intl`：时区名不落 i18n 词表（`Intl` 已有全部时区名），偏移量用 `shortOffset`（`GMT+8`），
 * 因为它不像 `short` 那样出现 `CST`（中国/芝加哥/美国中部三者同名）的歧义。
 */
export const shellTimeFormatPolicy = Object.freeze({
  /** 时间部分的字段顺序与宽度：与既有 `YYYY-MM-DD HH:mm` 显示保持一致。 */
  dateTimeSeparator: ' ',
  timeSeparator: ':'
})

export type ShellTimePrecision = 'minute' | 'second'

/**
 * 一个已解析的时区 id。`system` 是**设置值**，不是可格式化 id：这里按运行时解析，
 * 解析不出来时回落 `UTC`，绝不猜一个地理时区（与 `fallbackTimeZone` 同一常量）。
 */
export function resolveSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimeZone
  } catch {
    return fallbackTimeZone
  }
}

/** 设置值 → 可格式化时区 id（渲染层与 Main 取同一份设置时的共同口径）。 */
export function resolveShellTimeZone(setting: TimeZoneSetting | undefined): string {
  if (setting === undefined || setting === systemTimeZoneSetting) return resolveSystemTimeZone()
  return setting
}

/** 显示时区里的一个瞬时，只拆一次字段，两种宽度共用。 */
type ShellInstantParts = {
  year: string
  month: string
  day: string
  time: string
  zone: string
}

/**
 * 解析并拆分出一个 UTC 瞬时。
 *
 * `formatShellInstant`（带年份）与 `formatShellCompactInstant`（去掉年份）都走这里：
 * 两份宽度如果各写一套 `Intl` 选项，偏移与 `hourCycle` 迟早会漂开，同屏出现两个时刻。
 * 解析不了或时区非法 → `null`，由调用方决定「原样返回」。
 */
function readShellInstantParts(
  instant: string,
  options: Readonly<{ timeZone: string; locale?: string; precision?: ShellTimePrecision }>
): ShellInstantParts | null {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return null
  const precision = options.precision ?? 'minute'
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat(options.locale ?? 'zh-CN', {
      timeZone: options.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', ...(precision === 'second' ? { second: '2-digit' as const } : {}),
      hourCycle: 'h23', timeZoneName: 'shortOffset'
    }).formatToParts(new Date(parsed))
  } catch {
    return null
  }
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? ''
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    time: [value('hour'), value('minute'), ...(precision === 'second' ? [value('second')] : [])].join(shellTimeFormatPolicy.timeSeparator),
    zone: normalizeTimeZoneName(value('timeZoneName'))
  }
}

/**
 * 把一个 UTC 瞬时按显示时区写成 `2026-10-09 11:39 GMT+8`。
 *
 * 无法解析的输入原样返回：宁可显示原始字符串，也不显示一个由猜测拼出来的时刻。
 */
export function formatShellInstant(
  instant: string,
  options: Readonly<{ timeZone: string; locale?: string; precision?: ShellTimePrecision }>
): string {
  const at = readShellInstantParts(instant, options)
  if (at === null) return instant
  const date = `${at.year}-${at.month}-${at.day}`
  return [date, at.time, at.zone].filter(Boolean).join(shellTimeFormatPolicy.dateTimeSeparator)
}

/**
 * 紧凑时刻 `MM-DD HH:mm GMT+8`（通知中心合并条的「最近 {时间}」、列表行、手机正文都用它）。
 *
 * 与 `formatShellInstant` **同一套字段拆分**，只去掉年份：偏移仍取 `shortOffset`，不自己算，
 * 也不让调用点 `slice` 字符串——两处各拼一次，跨年或 DST 时一定会出现两个时刻。
 * 无法解析的输入原样返回（与 `formatShellInstant` 同一条策略）。
 */
export function formatShellCompactInstant(
  instant: string,
  options: Readonly<{ timeZone: string; locale?: string }>
): string {
  const at = readShellInstantParts(instant, options)
  if (at === null) return instant
  const date = `${at.month}-${at.day}`
  return [date, at.time, at.zone].filter(Boolean).join(shellTimeFormatPolicy.dateTimeSeparator)
}

/**
 * 把某个瞬时按显示时区写成 `YYYY-MM`（日历刷新这类按月取数的入口用）。
 * 不能用 `toISOString().slice(0,7)`：那是 UTC 的月份，月末差一天会取到错误的月。
 */
export function formatShellYearMonth(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(at)
    const year = parts.find((part) => part.type === 'year')?.value ?? ''
    const month = parts.find((part) => part.type === 'month')?.value ?? ''
    if (!year || !month) return at.toISOString().slice(0, 7)
    return `${year}-${month}`
  } catch {
    return at.toISOString().slice(0, 7)
  }
}

/**
 * 显示时区里的日键 `YYYY-MM-DD`：按天分组用。
 *
 * 不能拿 `toISOString().slice(0,10)` 顶替——那是 UTC 的日；东八区 07:00 的一条会被分到前一天，
 * 于是「今天」那一节里出现昨天的会话，而昨天的会话又不在任何一节里。
 */
export function formatShellDay(instant: string, timeZone: string): string | null {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(parsed))
    const read = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? ''
    const year = read('year')
    const month = read('month')
    const day = read('day')
    return year && month && day ? `${year}-${month}-${day}` : null
  } catch {
    return null
  }
}

/**
 * 同一个显示口径下的**紧凑时刻**，用于消息行这类空间紧张的位置：
 * 同一显示日 → `HH:mm`；跨日 → `MM-DD HH:mm`。
 *
 * 为什么不直接用 `formatShellInstant`：消息行放不下 `2026-11-01 15:44 GMT+8`。但时区与
 * `hourCycle` 必须还是这一份实现说了算，否则「时区设成非系统时区后同屏两套时间」的老毛病会回来。
 */
export function formatShellClock(
  instant: string,
  options: Readonly<{ timeZone: string; now?: Date }>
): string | null {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return null
  const now = options.now ?? new Date()
  const partsOf = (at: Date): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: options.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(at)
  const read = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = partsOf(new Date(parsed))
  } catch {
    return null
  }
  const time = `${read(parts, 'hour')}:${read(parts, 'minute')}`
  const today = partsOf(now)
  const sameDay =
    read(parts, 'year') === read(today, 'year') &&
    read(parts, 'month') === read(today, 'month') &&
    read(parts, 'day') === read(today, 'day')
  return sameDay ? time : `${read(parts, 'month')}-${read(parts, 'day')} ${time}`
}

/** 时区在界面上的短名称（`GMT+8` / `UTC`），用于设置项与时间标签。 */
export function formatShellTimeZoneLabel(timeZone: string, locale = 'zh-CN', at: Date = new Date()): string {
  try {
    const label = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find(part => part.type === 'timeZoneName')?.value
    return label ? normalizeTimeZoneName(label) : timeZone
  } catch {
    return timeZone
  }
}

/**
 * `shortOffset` names zero offset differently across ICU builds (`GMT`, `GMT+0`, `GMT+00:00`).
 * Keep one public spelling so the same instant is not labelled twice.
 */
function normalizeTimeZoneName(value: string): string {
  if (value === 'UTC' || /^GMT[+-]0(?::00)?$/.test(value)) return 'GMT'
  return value
}
