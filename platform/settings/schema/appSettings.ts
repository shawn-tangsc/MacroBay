import { normalizeNotificationSettings, type NotificationSettings } from './notificationSettings'
import { normalizeBypassRules } from './proxyBypassRules'

import { createDefaultNotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import {
  createDefaultAgentObservabilitySettings,
  normalizeAgentObservabilitySettings,
  type AgentObservabilitySettings
} from '../../ai/agent-platform/runtime/agentObservabilitySettings'
import {
  createDefaultWebSearchSettings,
  normalizeWebSearchSettings,
  type WebSearchSettings
} from '../../ai/web-search/contracts/webSearchSettings'

export const supportedLanguages = ['zh-CN', 'en-US'] as const
export const supportedThemeModes = ['system', 'light', 'dark'] as const
export const supportedAccentColors = ['lime', 'cyan', 'violet'] as const
export const supportedChatMessageStyles = ['plain', 'bubble'] as const
export const supportedChatSendShortcuts = ['enter', 'mod-enter'] as const
export const supportedChatMessageNavigations = ['none', 'buttons', 'anchor'] as const
export const supportedAgentSessionPanelPositions = ['left', 'right'] as const
export const supportedProxyModes = ['system', 'custom', 'none'] as const

/**
 * 时区偏好：`system` 跟随操作系统（默认），其余值是运行时认识的 IANA 时区（如 `Asia/Shanghai`）。
 *
 * 存在的理由：所有时间在存储与 IPC 上都保持规范 UTC 瞬时（`…Z`），显示时若写死 UTC，用户会看到与自己
 * 相差一个时区的时刻（真机症状：中国用户看到凌晨 3 点的分析时间）。
 *
 * **目标契约（已裁定，尚未实现）**：这个值是这个工作区的「墙上时钟」，同时决定**显示**和**「一天」的边界**
 * （cron 的「每天 09:00」、免打扰时段、分析日界）。现状是只决定显示：调度仍回落到运行这台机器的时区，
 * 所以用户改了它，时间标签会变、任务跑点不会变。收口方式是把 `trigger.timezone` 在注册时改为必填，
 * 一律由 `resolveShellTimeZone` 解析本值后传入；已存的调度保留它们自己的时区，改设置不重算历史。
 * 在此之前，任何把这个值描述成「只影响显示」或「已经影响调度」的文档都是错的。
 *
 * **2026-11-05 决定反转（上方口径作废，原文保留以便对照）**：用户定的是「改动尽量小——我改时区，
 * 任务定义不变，只是触发的实际时刻跟着变」。所以**不再要求注册时必填 `trigger.timezone`**，改为：
 * 注册时留空表示「跟随读者设置」，由**排程那一步**按当前设置解析，且**不写回**任务。
 * 理由一句：把注册那一刻的设置物化进任务，等于让「建任务时我人在哪」变成了任务的一部分，
 * 而那从来不是读者的决定（契约：`docs-private/10-development/task-timezone-scheduling-contract.md`）。
 * 显式指定过时区的任务仍然用存的值、不跟随——那是用户明确表达过的承诺。
 *
 * 校验不用固定枚举：历史/别名时区（`Asia/Chongqing`）也必须可用，因此以运行时能否格式化这段字符串为准。
 */
export const systemTimeZoneSetting = 'system' as const
/** 运行时认不出系统时区时的兜底显示时区；绝不猜一个地理时区。 */
export const fallbackTimeZone = 'UTC'
export const maximumTimeZoneCharacters = 64
/**
 * 已解析时区 id 的形状（`Asia/Shanghai`、`America/Argentina/ComodRivadavia`、`Etc/GMT+8`）。
 * Main 的偏好守卫与渲染层的上下文校验共用这一条判据，避免两侧各写一份宽度不同意的规则。
 */
export const timeZoneIdPattern = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/

export type AppLanguage = (typeof supportedLanguages)[number]
export type ThemeMode = (typeof supportedThemeModes)[number]
export type AccentColor = (typeof supportedAccentColors)[number]
export type ChatMessageStyle = (typeof supportedChatMessageStyles)[number]
export type ChatSendShortcut = (typeof supportedChatSendShortcuts)[number]
export type ChatMessageNavigation = (typeof supportedChatMessageNavigations)[number]
export type AgentSessionPanelPosition = (typeof supportedAgentSessionPanelPositions)[number]
export type ProxyMode = (typeof supportedProxyModes)[number]
export type TimeZoneSetting = typeof systemTimeZoneSetting | string

export type NetworkSettings = {
  proxyMode: ProxyMode
  proxyUrl: string
  proxyBypassRules: string
}

export type ChatSettings = {
  messageStyle: ChatMessageStyle
  fontSize: number
  sendShortcut: ChatSendShortcut
  confirmDeleteMessage: boolean
  messageNavigation: ChatMessageNavigation
  narrowMode: boolean
}

export type AgentSettings = {
  sessionPanelPosition: AgentSessionPanelPosition
  sessionNamingEnabled: boolean
  sessionNamingPrompt: string
  sessionNamingModelId: string
  taskAutomation: {
    policyPreset: 'balanced' | 'conservative'
  }
}

/**
 * 模型服务页顶部「默认模型」的 4 个选择。值形如 `providerId:modelId`，空串=未选择。
 * （此前平台只有两个命名模型字段，这 4 项没有存储位；这里新增一个独立分组，避免和命名设置混用。）
 */
export type ModelDefaultsSettings = {
  assistantModelId: string
  /** 智能体默认模型；候选只含能被智能体选中的模型（见 modelServiceDefaultModels）。 */
  agentModelId: string
  fastModelId: string
  translationModelId: string
  imageModelId: string
}

export type AssistantPlatformSettings = {
  topicNamingEnabled: boolean
  topicNamingPrompt: string
  topicNamingModelId: string
}

/** 通知设置的形状与归一在 `notificationSettings.ts`，这里只转出，保持既有 import 路径不变。 */
export { normalizeNotificationSettings }
export type { NotificationSettings }
export type ObservabilitySettings = AgentObservabilitySettings
export type PlatformWebSearchSettings = WebSearchSettings

/**
 * 更新提示（「知道有新版本」）的平台设置。
 *
 * 只有一个开关，而且它管的是**自动查**：关掉后启动阶段一个请求都不发，但设置页那个
 * 「检查更新」按钮仍然可点——把手动一起禁掉，等于用户想查时被拦住还要多解释一句。
 */
export type UpdateSettings = {
  checkEnabled: boolean
}

export function createDefaultUpdateSettings(): UpdateSettings {
  return { checkEnabled: true }
}

export type AppSettings = {
  language: AppLanguage
  themeMode: ThemeMode
  /**
   * 强调色：**保留、暂无机读方，也没有设置界面入口**（2026-11-01 用户裁决「先隐藏入口、存储保留不迁移」）。
   * 现状：主窗把它写进根属性 `data-accent`，但**没有任何样式按它取值**——样式表没有 `[data-accent]`
   * 选择器，`--accent` 按主题（浅/深）写死，组件库主题也硬编码 `lime`——也就是说改它的值，界面不会有
   * 任何变化。**在消费方接上之前，不许给它加回设置入口**：一个改了没反应的开关比没有更糟；设置页的
   * 守卫用例会因此变红（`AppShellPreferencesAccentGuard.test.ts`）。真正接通（令牌派生 accent 系列 +
   * 组件库主色跟随）作为独立需求立项，不从「顺手加个入口」开始。
   */
  accentColor: AccentColor
  /** 显示时区；存储与 IPC 上的时间始终是 UTC 瞬时。 */
  timeZone: TimeZoneSetting
  network: NetworkSettings
  agent: AgentSettings
  assistant: AssistantPlatformSettings
  modelDefaults: ModelDefaultsSettings
  chat: ChatSettings
  notifications: NotificationSettings
  observability: ObservabilitySettings
  webSearch: PlatformWebSearchSettings
  updates: UpdateSettings
}

export type AppSettingsPatch = Partial<Record<keyof AppSettings, unknown>>

const defaultProxyBypassRules = 'localhost,127.0.0.1,::1'

const legacyImplicitProxyDefault: NetworkSettings = {
  proxyMode: 'system',
  proxyUrl: 'socks5://127.0.0.1:1080',
  proxyBypassRules: defaultProxyBypassRules
}

function createDefaultNetworkSettings(): NetworkSettings {
  return {
    /**
     * 默认跟随操作系统代理（2026-11-02 用户决定，取代此前「默认直连」）：
     * 系统里配了代理的用户开箱即用；系统里没配代理时，Chromium 的 `system` 模式等价于直连。
     *
     * 代价写在这里，别让下一个人以为是随手改的：系统里若留着一条连不通的旧代理，
     * 新装用户的所有出站请求都会先走它再失败——「测试代理」按钮要能一眼看出归因。
     */
    proxyMode: 'system',
    proxyUrl: '',
    proxyBypassRules: defaultProxyBypassRules
  }
}

export function createDefaultAppSettings(): AppSettings {
  return {
    language: 'zh-CN',
    /** 默认深色（2026-11-02 用户决定）：与 `styles.css` 的 `:root` 深色 token 一致，首帧不会先亮一下。 */
    themeMode: 'dark',
    accentColor: 'lime',
    timeZone: systemTimeZoneSetting,
    network: createDefaultNetworkSettings(),
    agent: {
      sessionPanelPosition: 'left',
      sessionNamingEnabled: true,
      sessionNamingPrompt: '',
      sessionNamingModelId: '',
      taskAutomation: { policyPreset: 'balanced' }
    },
    assistant: {
      topicNamingEnabled: true,
      topicNamingPrompt: '',
      topicNamingModelId: ''
    },
    modelDefaults: {
      assistantModelId: '',
      agentModelId: '',
      fastModelId: '',
      translationModelId: '',
      imageModelId: ''
    },
    chat: {
      messageStyle: 'plain',
      fontSize: 14,
      sendShortcut: 'enter',
      confirmDeleteMessage: true,
      messageNavigation: 'none',
      narrowMode: false
    },
    notifications: createDefaultNotificationRuntimeSettings(),
    observability: createDefaultAgentObservabilitySettings(),
    webSearch: createDefaultWebSearchSettings(),
    updates: createDefaultUpdateSettings()
  }
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return supportedLanguages.includes(value as AppLanguage)
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return supportedThemeModes.includes(value as ThemeMode)
}

export function isAccentColor(value: unknown): value is AccentColor {
  return supportedAccentColors.includes(value as AccentColor)
}

/**
 * 合法时区 = `system`，或运行时能真正格式化的一段 IANA 时区 id。
 * 以运行时为准而不是固定枚举：别名时区（`Asia/Chongqing`）与历史 id 同样可用，非法值一律回落到默认。
 */
export function isTimeZoneSetting(value: unknown): value is TimeZoneSetting {
  if (value === systemTimeZoneSetting) return true
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumTimeZoneCharacters) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function isChatMessageStyle(value: unknown): value is ChatMessageStyle {
  return supportedChatMessageStyles.includes(value as ChatMessageStyle)
}

export function isChatSendShortcut(value: unknown): value is ChatSendShortcut {
  return supportedChatSendShortcuts.includes(value as ChatSendShortcut)
}

export function isChatMessageNavigation(value: unknown): value is ChatMessageNavigation {
  return supportedChatMessageNavigations.includes(value as ChatMessageNavigation)
}

export function isAgentSessionPanelPosition(value: unknown): value is AgentSessionPanelPosition {
  return supportedAgentSessionPanelPositions.includes(value as AgentSessionPanelPosition)
}

export function isProxyMode(value: unknown): value is ProxyMode {
  return supportedProxyModes.includes(value as ProxyMode)
}

export function normalizeNetworkSettings(
  value: unknown,
  defaults: NetworkSettings = createDefaultAppSettings().network
): NetworkSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof NetworkSettings, unknown>>
  const normalized = {
    proxyMode: isProxyMode(candidate.proxyMode) ? candidate.proxyMode : defaults.proxyMode,
    proxyUrl: typeof candidate.proxyUrl === 'string' ? candidate.proxyUrl.trim() : defaults.proxyUrl,
    // 历史数据可能用分号分隔、夹着 `:1` 这类残留：读取时就归一化成 Chromium 语法，
    // 否则一次无关保存也会被旧规则挡住。
    proxyBypassRules: normalizeBypassRules(
      typeof candidate.proxyBypassRules === 'string' ? candidate.proxyBypassRules : defaults.proxyBypassRules
    )
  }

  if (isLegacyImplicitProxyDefault(normalized)) {
    return defaults
  }

  return normalized
}

function isLegacyImplicitProxyDefault(network: NetworkSettings): boolean {
  return (
    network.proxyMode === legacyImplicitProxyDefault.proxyMode &&
    network.proxyUrl === legacyImplicitProxyDefault.proxyUrl &&
    network.proxyBypassRules === legacyImplicitProxyDefault.proxyBypassRules
  )
}

export function normalizeAppSettings(
  value: unknown,
  /**
   * 通知设置里出现了类型不认识的字段时回调（每个字段名由调用方去重）。
   * 用回调而不是直接打日志：这一层是纯函数，测试里能直接断言「报没报、报了几次」。
   */
  onUnknownNotificationField?: (field: string) => void
): AppSettings {
  const defaults = createDefaultAppSettings()
  if (!value || typeof value !== 'object') return defaults

  const candidate = value as Partial<Record<keyof AppSettings, unknown>>
  return {
    language: isAppLanguage(candidate.language) ? candidate.language : defaults.language,
    themeMode: isThemeMode(candidate.themeMode) ? candidate.themeMode : defaults.themeMode,
    accentColor: isAccentColor(candidate.accentColor) ? candidate.accentColor : defaults.accentColor,
    timeZone: isTimeZoneSetting(candidate.timeZone) ? candidate.timeZone : defaults.timeZone,
    network: normalizeNetworkSettings(candidate.network, defaults.network),
    agent: normalizeAgentSettings(candidate.agent, defaults.agent),
    assistant: normalizeAssistantPlatformSettings(candidate.assistant, defaults.assistant),
    modelDefaults: normalizeModelDefaultsSettings(candidate.modelDefaults, defaults.modelDefaults),
    chat: normalizeChatSettings(candidate.chat, defaults.chat),
    notifications: normalizeNotificationSettings(candidate.notifications, defaults.notifications, onUnknownNotificationField),
    observability: normalizeAgentObservabilitySettings(candidate.observability, defaults.observability),
    webSearch: normalizeWebSearchSettings(candidate.webSearch, defaults.webSearch),
    updates: normalizeUpdateSettings(candidate.updates, defaults.updates)
  }
}

/**
 * 更新设置的归一化。**这里是本功能唯一的静默失败点**：写数据的地方不漏（否则存了读不回），
 * 旧 `settings.json` 根本没有这一组时补默认（默认开），脏值（字符串、`null`、`{}`）回落默认。
 * 三条都有测试兜着，`appSettings.test.ts` 与 `settingsStore.test.ts` 各守一半。
 */
export function normalizeUpdateSettings(
  value: unknown,
  defaults: UpdateSettings = createDefaultAppSettings().updates
): UpdateSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof UpdateSettings, unknown>>
  return {
    checkEnabled: typeof candidate.checkEnabled === 'boolean' ? candidate.checkEnabled : defaults.checkEnabled
  }
}

export function normalizeModelDefaultsSettings(
  value: unknown,
  defaults: ModelDefaultsSettings = createDefaultAppSettings().modelDefaults
): ModelDefaultsSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof ModelDefaultsSettings, unknown>>
  const read = (key: keyof ModelDefaultsSettings): string =>
    typeof candidate[key] === 'string' ? (candidate[key] as string).trim() : defaults[key]
  return {
    assistantModelId: read('assistantModelId'),
    agentModelId: read('agentModelId'),
    fastModelId: read('fastModelId'),
    translationModelId: read('translationModelId'),
    imageModelId: read('imageModelId')
  }
}

export function normalizeAgentSettings(
  value: unknown,
  defaults: AgentSettings = createDefaultAppSettings().agent
): AgentSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof AgentSettings, unknown>>
  return {
    sessionPanelPosition: isAgentSessionPanelPosition(candidate.sessionPanelPosition)
      ? candidate.sessionPanelPosition
      : defaults.sessionPanelPosition,
    sessionNamingEnabled:
      typeof candidate.sessionNamingEnabled === 'boolean'
        ? candidate.sessionNamingEnabled
        : defaults.sessionNamingEnabled,
    sessionNamingPrompt:
      typeof candidate.sessionNamingPrompt === 'string'
        ? candidate.sessionNamingPrompt
        : defaults.sessionNamingPrompt,
    sessionNamingModelId:
      typeof candidate.sessionNamingModelId === 'string'
        ? candidate.sessionNamingModelId.trim()
        : defaults.sessionNamingModelId,
    taskAutomation: {
      policyPreset:
        candidate.taskAutomation &&
        typeof candidate.taskAutomation === 'object' &&
        (candidate.taskAutomation as { policyPreset?: unknown }).policyPreset === 'conservative'
          ? 'conservative'
          : candidate.taskAutomation &&
              typeof candidate.taskAutomation === 'object' &&
              (candidate.taskAutomation as { policyPreset?: unknown }).policyPreset === 'balanced'
            ? 'balanced'
            : defaults.taskAutomation.policyPreset
    }
  }
}

export function normalizeAssistantPlatformSettings(
  value: unknown,
  defaults: AssistantPlatformSettings = createDefaultAppSettings().assistant
): AssistantPlatformSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof AssistantPlatformSettings, unknown>>
  return {
    topicNamingEnabled:
      typeof candidate.topicNamingEnabled === 'boolean'
        ? candidate.topicNamingEnabled
        : defaults.topicNamingEnabled,
    topicNamingPrompt:
      typeof candidate.topicNamingPrompt === 'string' ? candidate.topicNamingPrompt.trim() : defaults.topicNamingPrompt,
    topicNamingModelId:
      typeof candidate.topicNamingModelId === 'string'
        ? candidate.topicNamingModelId.trim()
        : defaults.topicNamingModelId
  }
}

export function normalizeChatSettings(value: unknown, defaults: ChatSettings = createDefaultAppSettings().chat): ChatSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<Record<keyof ChatSettings, unknown>>
  const fontSize =
    typeof candidate.fontSize === 'number' &&
    Number.isFinite(candidate.fontSize) &&
    candidate.fontSize >= 12 &&
    candidate.fontSize <= 22
      ? candidate.fontSize
      : defaults.fontSize

  return {
    messageStyle: isChatMessageStyle(candidate.messageStyle) ? candidate.messageStyle : defaults.messageStyle,
    fontSize,
    sendShortcut: isChatSendShortcut(candidate.sendShortcut) ? candidate.sendShortcut : defaults.sendShortcut,
    confirmDeleteMessage:
      typeof candidate.confirmDeleteMessage === 'boolean' ? candidate.confirmDeleteMessage : defaults.confirmDeleteMessage,
    messageNavigation: isChatMessageNavigation(candidate.messageNavigation)
      ? candidate.messageNavigation
      : defaults.messageNavigation,
    narrowMode: typeof candidate.narrowMode === 'boolean' ? candidate.narrowMode : defaults.narrowMode
  }
}
