import {
  applyDailyBriefingAiSettingsPatch,
  type DailyBriefingAiSettings,
  type DailyBriefingAiSettingsPatch
} from '../schema/dailyBriefingAiSettings'
import {
  resolveDailyBriefingEditorialModel,
  type DailyBriefingEditorialModel,
  type DailyBriefingModelResolverDeps
} from './dailyBriefingAiSettings'
import type { DailyBriefingAiSettingsStore } from './dailyBriefingAiSettingsStore'

export type DailyBriefingAiSettingsView = Readonly<{
  settings: Readonly<{ editorialEnabled: boolean; providerId: string; modelId: string }>
  resolved: DailyBriefingEditorialModel
}>

export type DailyBriefingAiSettingsService = Readonly<{
  getView: () => Promise<DailyBriefingAiSettingsView>
  save: (patch: DailyBriefingAiSettingsPatch) => Promise<DailyBriefingAiSettingsView>
}>

export function createDailyBriefingAiSettingsService(deps: Readonly<{
  store: DailyBriefingAiSettingsStore
  now?: () => string
}> & DailyBriefingModelResolverDeps): DailyBriefingAiSettingsService {
  const now = deps.now ?? (() => new Date().toISOString())

  async function view(settings: DailyBriefingAiSettings): Promise<DailyBriefingAiSettingsView> {
    return Object.freeze({
      settings: Object.freeze({
        editorialEnabled: settings.editorialEnabled,
        providerId: settings.providerId,
        modelId: settings.modelId
      }),
      resolved: await resolveDailyBriefingEditorialModel(settings, deps)
    })
  }

  return {
    async getView() {
      return view(await deps.store.getSettings())
    },
    async save(patch) {
      const current = await deps.store.getSettings()
      const next = applyDailyBriefingAiSettingsPatch(current, patch, now())
      return view(await deps.store.save(next))
    }
  }
}
