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

/**
 * 把一个 UTC 瞬时按显示时区写成 `2026-10-09 11:39 GMT+8`。
 *
 * 无法解析的输入原样返回：宁可显示原始字符串，也不显示一个由猜测拼出来的时刻。
 */
export function formatShellInstant(
  instant: string,
  options: Readonly<{ timeZone: string; locale?: string; precision?: ShellTimePrecision }>
): string {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) return instant
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
    return instant
  }
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? ''
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const time = [value('hour'), value('minute'), ...(precision === 'second' ? [value('second')] : [])].join(shellTimeFormatPolicy.timeSeparator)
  const zone = value('timeZoneName')
  return [date, time, zone].filter(Boolean).join(shellTimeFormatPolicy.dateTimeSeparator)
}

/** 时区在界面上的短名称（`GMT+8` / `UTC`），用于设置项与时间标签。 */
export function formatShellTimeZoneLabel(timeZone: string, locale = 'zh-CN', at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? timeZone
  } catch {
    return timeZone
  }
}
