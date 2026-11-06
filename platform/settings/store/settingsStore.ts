import {
  type AppSettings,
  type AppSettingsPatch,
  createDefaultAppSettings,
  isAccentColor,
  isAppLanguage,
  isTimeZoneSetting,
  isThemeMode,
  normalizeAgentSettings,
  normalizeAssistantPlatformSettings,
  normalizeModelDefaultsSettings,
  normalizeChatSettings,
  normalizeAppSettings,
  normalizeNetworkSettings,
  normalizeNotificationSettings,
  normalizeUpdateSettings
} from '../schema/appSettings'
import { normalizeAgentObservabilitySettings } from '../../ai/agent-platform/runtime/agentObservabilitySettings'
import { normalizeWebSearchSettings } from '../../ai/web-search/contracts/webSearchSettings'

export type SettingsStorage = {
  read: () => Promise<unknown>
  write: (settings: AppSettings) => Promise<void>
}

export type SettingsStore = {
  get: () => Promise<AppSettings>
  update: (patch: AppSettingsPatch) => Promise<AppSettings>
  /**
   * 订阅「设置已提交」。方向是订阅方 → 平台：产品在自己的 bootstrap 里注册，
   * 平台不 import 任何产品，也不新开 preload/IPC 通道（和 `jobRuntime.registerHandler` 同构）。
   * 返回退订函数。
   */
  onCommitted: (listener: SettingsCommittedListener) => () => void
  /**
   * 通知上一次成功提交。**由装配方在本次提交的全部副作用之后调用**
   * （时区刷新、代理应用、语言重解析都已完成），订阅方读到的必须是生效后的状态。
   *
   * 这次保存没有改变任何值时**不通知**：同值保存不该让订阅方重排一次任务。
   * 订阅方抛错不会让已经落盘的设置变成一次失败的保存。
   */
  notifyCommitted: () => void
}

/** 一次设置提交：改前、改后、原始 patch，以及顶层字段里真正变了的那些。 */
export type SettingsCommittedChange = Readonly<{
  previous: AppSettings
  next: AppSettings
  patch: AppSettingsPatch
  /** 空数组表示这次保存没有改变任何值——订阅方据此跳过，不必自己比一遍。 */
  changedKeys: readonly (keyof AppSettings)[]
}>

export type SettingsCommittedListener = (change: SettingsCommittedChange) => void

export function updateAppSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    language: isAppLanguage(patch.language) ? patch.language : current.language,
    themeMode: isThemeMode(patch.themeMode) ? patch.themeMode : current.themeMode,
    accentColor: isAccentColor(patch.accentColor) ? patch.accentColor : current.accentColor,
    timeZone: isTimeZoneSetting(patch.timeZone) ? patch.timeZone : current.timeZone,
    network: patch.network === undefined ? current.network : normalizeNetworkSettings(patch.network, current.network),
    agent: patch.agent === undefined ? current.agent : normalizeAgentSettings(patch.agent, current.agent),
    assistant:
      patch.assistant === undefined
        ? current.assistant
        : normalizeAssistantPlatformSettings(patch.assistant, current.assistant),
    modelDefaults:
      patch.modelDefaults === undefined
        ? current.modelDefaults
        : normalizeModelDefaultsSettings(patch.modelDefaults, current.modelDefaults),
    chat: patch.chat === undefined ? current.chat : normalizeChatSettings(patch.chat, current.chat),
    notifications:
      patch.notifications === undefined
        ? current.notifications
        : normalizeNotificationSettings(patch.notifications, current.notifications),
    observability:
      patch.observability === undefined
        ? current.observability
        : normalizeAgentObservabilitySettings(patch.observability, current.observability),
    webSearch:
      patch.webSearch === undefined ? current.webSearch : normalizeWebSearchSettings(patch.webSearch, current.webSearch),
    updates:
      patch.updates === undefined ? current.updates : normalizeUpdateSettings(patch.updates, current.updates)
  }
}

export function createSettingsStore(storage?: SettingsStorage): SettingsStore {
  let settings: AppSettings | null = null
  let updateQueue: Promise<void> = Promise.resolve()
  const listeners = new Set<SettingsCommittedListener>()
  /** 上一次成功提交的待通知内容；`notifyCommitted` 消费后清空，避免重复通知。 */
  let pending: SettingsCommittedChange | null = null

  async function load(): Promise<AppSettings> {
    if (settings) return settings
    if (!storage) {
      settings = createDefaultAppSettings()
      return settings
    }

    settings = normalizeAppSettings(await storage.read())
    return settings
  }

  return {
    get: load,
    async update(patch) {
      const operation = updateQueue.then(async () => {
        const previous = await load()
        const next = updateAppSettings(previous, patch)
        await storage?.write(next)
        settings = next
        pending = { previous, next, patch, changedKeys: changedSettingKeys(previous, next) }
        return next
      })
      updateQueue = operation.then(() => undefined, () => undefined)
      return operation
    },
    onCommitted(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notifyCommitted() {
      const change = pending
      pending = null
      // 同值保存不通知：既没有可做的事，也会让订阅方白重排一次。
      if (!change || change.changedKeys.length === 0) return
      for (const listener of [...listeners]) {
        try {
          listener(change)
        } catch {
          // 通知不 reject：设置已经落盘，订阅方的失败不能把它变成一次「保存失败」。
        }
      }
    }
  }
}

/** 顶层字段里真正变了的那些；用同一份比较，订阅方就不必自己再比一遍。 */
function changedSettingKeys(previous: AppSettings, next: AppSettings): (keyof AppSettings)[] {
  return (Object.keys(next) as (keyof AppSettings)[]).filter((key) => previous[key] !== next[key])
}
