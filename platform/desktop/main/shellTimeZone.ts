import { fallbackTimeZone, systemTimeZoneSetting, type TimeZoneSetting } from '../../settings/schema/appSettings'

/** 只需要 settings 里 `timeZone` 这一个字段；注入是为了测试与启动顺序。 */
export type ShellTimeZoneSettingsReader = {
  get: () => Promise<{ timeZone: TimeZoneSetting }>
}

/**
 * 主进程侧「读者时区」的唯一提供者：cron 默认时区、任务下次运行、日报调度、免打扰窗口、
 * 分析槽位的展示归属，全部从 `get()` 取，不许再各自 `Intl.DateTimeFormat().resolvedOptions()`。
 *
 * 计数语义（额度、连续天数、保留期、预算窗口、幂等日界）固定 UTC，**不经过这里**。
 */
export type ShellTimeZoneProvider = {
  /** 当前生效的 IANA 时区 id。首次 `refresh()` 之前回落运行时系统时区。 */
  get: () => string
  /** 设置保存后调用：重新读取设置并缓存解析结果。 */
  refresh: () => Promise<string>
}

export function readSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimeZone
  } catch {
    return fallbackTimeZone
  }
}

/** 只有 Intl 认得、且真能格式化的时区才算可用；其它一律回落，避免把一个坏 id 传给调度器。 */
export function isUsableTimeZone(value: string | undefined): value is string {
  if (!value) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * 设置值 → 实际时区 id。`system` 用运行时解析结果；显式时区优先，但不可用时回落系统时区，
 * 系统时区也不可用时回落 UTC。任何一条路径都不会返回空串。
 */
export function resolveTimeZoneSetting(
  setting: TimeZoneSetting | undefined,
  systemTimeZone: string = readSystemTimeZone()
): string {
  const usableSystem = isUsableTimeZone(systemTimeZone) ? systemTimeZone : fallbackTimeZone
  if (setting === undefined || setting === systemTimeZoneSetting) return usableSystem
  return isUsableTimeZone(setting) ? setting : usableSystem
}

export function createShellTimeZoneProvider(deps: {
  settings: ShellTimeZoneSettingsReader
  systemTimeZone?: () => string
}): ShellTimeZoneProvider {
  const systemTimeZone = deps.systemTimeZone ?? readSystemTimeZone
  let current = resolveTimeZoneSetting(undefined, systemTimeZone())

  return {
    get: () => current,
    refresh: async () => {
      const settings = await deps.settings.get()
      current = resolveTimeZoneSetting(settings.timeZone, systemTimeZone())
      return current
    }
  }
}
