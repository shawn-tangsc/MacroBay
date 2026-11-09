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
  /**
   * 读到损坏内容时留一份 `.corrupt-*` 副本（**不改原文件**）；留档失败要抛。
   * 由 `createJsonFileStorage` 提供；用例里的内存存储可以不实现。
   */
  preserveCorruptCopy?: (error: unknown) => Promise<void>
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

export function updateAppSettings(
  current: AppSettings,
  patch: AppSettingsPatch,
  onUnknownNotificationField?: (field: string) => void
): AppSettings {
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
        : normalizeNotificationSettings(patch.notifications, current.notifications, onUnknownNotificationField),
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

export function createSettingsStore(
  storage?: SettingsStorage,
  options: {
    /**
     * 通知设置里出现了类型不认识的字段：**保留**，但每个字段名只报一次。
     *
     * 只报一次是因为它在每次读盘时都会出现——不记一次就变成每次启动都刷一行；
     * 完全不报又会让拼错的键永久潜伏、谁都以为它在生效。
     */
    onUnknownNotificationField?: (field: string) => void
  } = {}
): SettingsStore {
  const reportedUnknownFields = new Set<string>()
  const reportUnknownField = (field: string): void => {
    if (reportedUnknownFields.has(field)) return
    reportedUnknownFields.add(field)
    options.onUnknownNotificationField?.(field)
  }
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

    let raw: unknown
    try {
      raw = await storage.read()
    } catch (error) {
      // 「读不到」不是「从没配过」：前者必须报错（界面是读失败/保存失败），后者才可以用默认值。
      // 先把损坏的原文留一份 `.corrupt-*`（不改原文件）；留档失败就 fail-closed，继续往上抛。
      if (storage.preserveCorruptCopy) await storage.preserveCorruptCopy(error)
      throw new SettingsStorageUnreadableError()
    }
    settings = normalizeAppSettings(raw, reportUnknownField)
    return settings
  }

  return {
    get: load,
    async update(patch) {
      const operation = updateQueue.then(async () => {
        const previous = await load()
        const next = updateAppSettings(previous, patch, reportUnknownField)
        // 落盘只写「读者这次真正改的顶层字段」，其余字段按**磁盘上的原文**原样写回。
        //
        // 为什么不是直接写 `next`：`normalizeAppSettings` 是**读时归一**，它会把旧形状改写成
        // 新形状（例如旧代理三联 `system + socks5://127.0.0.1:1080 + 默认绕过` 被当成历史默认值
        // 折成 `system + 空地址`）。把归一后的整份对象写回去，等于读者只改了一次主题，却把
        // 他从未碰过的代理设置也静默落盘成了新值——旧值再也拿不回来。所以：
        // - 内存里始终用归一后的 `next`（读的人拿到的是一份自洽的设置）；
        // - 磁盘上没被 `patch` 点到的顶层字段保持原样，连类型不认识的字段一起留着。
        await storage?.write(await mergePatchedOntoDisk(storage, patch, next))
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

/**
 * 设置文件读不出来时**拒绝保存**的错误。
 *
 * 单独一个类型，是为了让调用方能把它和「写入失败」分开显示：两种都是「这次没保存上」，
 * 但前者意味着磁盘上那份文件需要人看一眼，后者重试就行。
 */
export class SettingsStorageUnreadableError extends Error {
  constructor() {
    super('settings-storage-unreadable')
    this.name = 'SettingsStorageUnreadableError'
  }
}

/**
 * 把「这次改的顶层字段」叠到**磁盘原文**上：点到的字段用归一后的新值，其余原样。
 *
 * `storage.read()` 拿到的是磁盘上真实的 JSON；读失败/缺文件时退回归一后的整份文档
 * （新装用户的第一次保存不该因为「没有原文」而被拦下）。
 */
async function mergePatchedOntoDisk(
  storage: SettingsStorage | undefined,
  patch: AppSettingsPatch,
  next: AppSettings
): Promise<AppSettings> {
  if (!storage) return next
  let raw: unknown
  try {
    raw = await storage.read()
  } catch (error) {
    // 读失败 = 文件坏了（不是「从没配过」——那种情况 `read()` 返回默认值，不抛）。
    //
    // 这里**绝不能**拿归一后的默认值整份写回去：内存里那份是加载时的快照，磁盘上这一份才是
    // 读者真正的配置，覆盖它等于把主题、语言、时区、代理、模型默认值一次抹掉。做法：
    // ① 先留一份 `.corrupt-*` 副本（留档失败就 fail-closed，不在来路不明的文件上写）；
    // ② 把这次保存**拒绝**给调用方，由界面显示「保存失败」，让人自己去处理那个文件。
    if (storage.preserveCorruptCopy) await storage.preserveCorruptCopy(error)
    throw new SettingsStorageUnreadableError()
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return next
  const rawRecord = raw as Record<string, unknown>
  const merged: Record<string, unknown> = { ...rawRecord }
  for (const key of Object.keys(patch)) {
    merged[key] = (next as unknown as Record<string, unknown>)[key]
  }
  // 顶层字段集以归一后的文档为准：新版本新增的顶层键即使文件里没有，也要写全，
  // 否则下一次读会因为缺字段再走一遍默认值。
  for (const key of Object.keys(next)) {
    if (!(key in merged)) merged[key] = (next as unknown as Record<string, unknown>)[key]
  }
  return merged as unknown as AppSettings
}

/** 顶层字段里真正变了的那些；用同一份比较，订阅方就不必自己再比一遍。 */
function changedSettingKeys(previous: AppSettings, next: AppSettings): (keyof AppSettings)[] {
  return (Object.keys(next) as (keyof AppSettings)[]).filter((key) => previous[key] !== next[key])
}
