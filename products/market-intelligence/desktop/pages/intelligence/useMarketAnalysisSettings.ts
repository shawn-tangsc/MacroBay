import { useCallback, useEffect, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'

import {
  marketAnalysisTimelineClient,
  type MarketAnalysisSettingsPatch,
  type MarketAnalysisSettingsSaveResult,
  type MarketAnalysisSettingsView
} from '../../shared/ipc/marketAnalysisTimelineClient'

export type MarketAnalysisSettingsRefusal = Extract<MarketAnalysisSettingsSaveResult, { state: 'refused' }>['reason']

/** The platform's default assistant model, which an empty choice follows. */
export type MarketAnalysisDefaultModel = Readonly<{
  providerId: string
  modelId: string
  providerName: string
  modelName: string
}>

/**
 * The panel and the main-area conclusion card each read the switches, so a save in one must not
 * leave the other showing the previous state. This is a change signal only — every instance
 * re-reads, so there is one stored truth (the product settings file) and no second copy here.
 */
const listeners = new Set<() => void>()

function announceSettingsChanged(): void {
  for (const listener of listeners) listener()
}

export type UseMarketAnalysisSettingsResult = Readonly<{
  /** Absent while the first read is in flight or when the service cannot answer. */
  settings?: MarketAnalysisSettingsView
  /** The model candidates the picker offers; the platform's chat-capable models. */
  providers: readonly SafeModelProvider[]
  /**
   * What "leave it empty" means right now, resolved from the model service's default assistant
   * model. The picker shows this instead of a name the reader never picked.
   */
  defaultModel?: MarketAnalysisDefaultModel | null
  saving: boolean
  refusal?: MarketAnalysisSettingsRefusal
  /** The dialog is the only writer: the mask opens it instead of saving on its own. */
  save: (patch: MarketAnalysisSettingsPatch) => Promise<boolean>
  reload: () => void
}>

async function readAssistantModelId(): Promise<string | undefined> {
  try {
    const settings = await window.platform?.settings?.get() as { modelDefaults?: { assistantModelId?: unknown } } | undefined
    const value = settings?.modelDefaults?.assistantModelId
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function resolveDefaultAssistantModel(
  providers: readonly SafeModelProvider[],
  assistantModelId: string | undefined
): MarketAnalysisDefaultModel | null {
  if (!assistantModelId) return null
  const resolved = resolveConfiguredModel({
    value: assistantModelId,
    providers,
    isModelAcceptable: (_provider, model) => model.capabilities.chat === true
  })
  return resolved.ok
    ? { providerId: resolved.ref.providerId, modelId: resolved.ref.modelId, providerName: resolved.providerName, modelName: resolved.modelName }
    : null
}

/**
 * Owns the analysis switches for whichever surface renders the timeline.
 *
 * The panel is a thin view: it says what the reader chose, and the service decides whether that
 * choice is usable (a model that cannot be called now is refused there, not here). Settings that
 * have not been read yet are "unknown", never "off" — a failed read must not draw the mask over a
 * panel that is in fact enabled.
 */
export function useMarketAnalysisSettings(): UseMarketAnalysisSettingsResult {
  const [settings, setSettings] = useState<MarketAnalysisSettingsView>()
  const [providers, setProviders] = useState<readonly SafeModelProvider[]>([])
  const [defaultModel, setDefaultModel] = useState<MarketAnalysisDefaultModel | null>()
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<MarketAnalysisSettingsRefusal>()

  const reload = useCallback(() => {
    const read = async (): Promise<void> => {
      const next = await marketAnalysisTimelineClient.getSettings().catch(() => undefined)
      if (next) setSettings(next)
      try {
        const candidates = await window.platform?.modelProviders?.list() as SafeModelProvider[] | undefined
        const available = candidates ?? []
        setProviders(available)
        setDefaultModel(resolveDefaultAssistantModel(available, await readAssistantModelId()))
      } catch {
        // An empty picker is honest about a failed read; it must not block the switch.
      }
    }
    void read()
  }, [])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const listener = (): void => reload()
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [reload])

  const apply = useCallback(async (patch: MarketAnalysisSettingsPatch): Promise<boolean> => {
    setSaving(true)
    setRefusal(undefined)
    try {
      const result = await marketAnalysisTimelineClient.saveSettings(patch)
      if (result.state === 'saved') {
        setSettings(result.settings)
        announceSettingsChanged()
        return true
      }
      setRefusal(result.reason)
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  return {
    settings,
    providers,
    defaultModel,
    saving,
    refusal,
    save: apply,
    reload
  }
}
