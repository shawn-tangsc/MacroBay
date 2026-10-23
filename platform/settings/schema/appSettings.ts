import {
  createDefaultNotificationRuntimeSettings,
  type NotificationRuntimeSettings
} from '@platform/notifications/contracts/notificationContracts'
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
 * 相差一个时区的时刻（真机症状：中国用户看到凌晨 3 点的分析时间）。这里只决定**显示**用哪个时区。
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

export type NotificationSettings = NotificationRuntimeSettings
export type ObservabilitySettings = AgentObservabilitySettings
export type PlatformWebSearchSettings = WebSearchSettings

export type AppSettings = {
  language: AppLanguage
  themeMode: ThemeMode
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
    proxyMode: 'none',
    proxyUrl: '',
    proxyBypassRules: defaultProxyBypassRules
  }
}

export function createDefaultAppSettings(): AppSettings {
  return {
    language: 'zh-CN',
    themeMode: 'system',
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
    webSearch: createDefaultWebSearchSettings()
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
    proxyBypassRules:
      typeof candidate.proxyBypassRules === 'string' ? candidate.proxyBypassRules.trim() : defaults.proxyBypassRules
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

export function normalizeAppSettings(value: unknown): AppSettings {
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
    notifications: normalizeNotificationSettings(candidate.notifications, defaults.notifications),
    observability: normalizeAgentObservabilitySettings(candidate.observability, defaults.observability),
    webSearch: normalizeWebSearchSettings(candidate.webSearch, defaults.webSearch)
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

export function normalizeNotificationSettings(
  value: unknown,
  defaults: NotificationSettings = createDefaultAppSettings().notifications
): NotificationSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<NotificationSettings>
  return {
    centerEnabled: typeof candidate.centerEnabled === 'boolean' ? candidate.centerEnabled : defaults.centerEnabled,
    desktopEnabled: typeof candidate.desktopEnabled === 'boolean' ? candidate.desktopEnabled : defaults.desktopEnabled,
    toastEnabled: typeof candidate.toastEnabled === 'boolean' ? candidate.toastEnabled : defaults.toastEnabled,
    popupEnabled: typeof candidate.popupEnabled === 'boolean' ? candidate.popupEnabled : defaults.popupEnabled,
    retentionDays:
      typeof candidate.retentionDays === 'number' && candidate.retentionDays > 0
        ? Math.round(candidate.retentionDays)
        : defaults.retentionDays,
    defaultSnoozeMinutes:
      typeof candidate.defaultSnoozeMinutes === 'number' && candidate.defaultSnoozeMinutes > 0
        ? Math.round(candidate.defaultSnoozeMinutes)
        : defaults.defaultSnoozeMinutes,
    quietHours: candidate.quietHours
      ? {
          enabled: Boolean(candidate.quietHours.enabled),
          startLocalTime:
            typeof candidate.quietHours.startLocalTime === 'string'
              ? candidate.quietHours.startLocalTime
              : defaults.quietHours?.startLocalTime ?? '22:00',
          endLocalTime:
            typeof candidate.quietHours.endLocalTime === 'string'
              ? candidate.quietHours.endLocalTime
              : defaults.quietHours?.endLocalTime ?? '08:00'
        }
      : defaults.quietHours,
    minimumDisruptivePriority: candidate.minimumDisruptivePriority ?? defaults.minimumDisruptivePriority,
    productPermissions: candidate.productPermissions ?? defaults.productPermissions
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
