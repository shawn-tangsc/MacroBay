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
  normalizeNotificationSettings
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
}

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
      patch.webSearch === undefined ? current.webSearch : normalizeWebSearchSettings(patch.webSearch, current.webSearch)
  }
}

export function createSettingsStore(storage?: SettingsStorage): SettingsStore {
  let settings: AppSettings | null = null
  let updateQueue: Promise<void> = Promise.resolve()

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
        const next = updateAppSettings(await load(), patch)
        await storage?.write(next)
        settings = next
        return next
      })
      updateQueue = operation.then(() => undefined, () => undefined)
      return operation
    }
  }
}
