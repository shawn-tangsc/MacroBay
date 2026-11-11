import { useEffect, useMemo, useState } from 'react'

import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { ModelPickerCandidate } from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'

/**
 * 日报「AI 编辑」那一段的**读写**：读者可改的三样（使用 AI 编辑 / 允许补查 / 模型）与它们的状态。
 *
 * 从屏幕组件里拆出来，是因为抽屉屏只借这段数据、不再渲染旧组件；脏判据也由它一处给出：
 * `dirty = 草稿 ≠ 已存值`，保存成功把基线前进，读失败没有草稿（不脏）。
 */

type AiDraft = Readonly<{
  editorialEnabled: boolean
  providerId: string
  modelId: string
  webSearchEnabled: boolean
  webSearchAuthorizedAt?: string
}>

export type DailyBriefingAiSettingsState = Readonly<{
  state: 'loading' | 'ready' | 'load-failed' | 'save-failed'
  saving: boolean
  save: () => Promise<boolean>
  reload: () => void
  draft: AiDraft | null
  /** True when the reader has edited something that a save would write. */
  dirty: boolean
  update: (patch: Partial<AiDraft>) => void
  providers: readonly SafeModelProvider[]
  candidates: readonly ModelPickerCandidate[]
  defaultModel: Readonly<{ providerId: string; modelId: string; providerName: string; modelName: string }> | null
  webSearchSupported: boolean
  webSearchBlocked: boolean
  clearWebSearchBlocked: () => void
}>

/**
 * Reads and writes the brief's editorial preference: on/off, WebSearch, and the model.
 *
 * Platform-global values (model service, web search provider) are **not** editable here and this
 * block offers no jump to them — the settings drawer keeps one link row for those, so the drawer
 * never grows a second copy of a global setting.
 */
export function useDailyBriefingAiSettings(input: Readonly<{
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  /** The host defers reading until its surface opens; default is to read immediately. */
  enabled?: boolean
}>): DailyBriefingAiSettingsState {
  const [state, setState] = useState<'loading' | 'ready' | 'load-failed' | 'save-failed'>('loading')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<AiDraft | null>(null)
  // What was read, kept to answer "did the reader change anything".
  const [loaded, setLoaded] = useState<AiDraft | null>(null)
  const [providers, setProviders] = useState<readonly SafeModelProvider[]>([])
  const [defaultModel, setDefaultModel] = useState<Readonly<{ providerId: string; modelId: string; providerName: string; modelName: string }> | null>(null)
  const [webSearchSupported, setWebSearchSupported] = useState(false)
  const [webSearchBlocked, setWebSearchBlocked] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (input.enabled === false) return
    let active = true
    setState('loading')
    setDraft(null)
    setWebSearchBlocked(false)
    void (async () => {
      const providersPromise = window.platform?.modelProviders?.list
        ? window.platform.modelProviders.list().catch(() => [] as SafeModelProvider[])
        : Promise.resolve([] as SafeModelProvider[])
      const [settings, modelProviders] = await Promise.all([input.client.getSettings().catch(() => undefined), providersPromise])
      if (!active) return
      if (!settings || settings.state !== 'available') {
        setState('load-failed')
        return
      }
      const next = {
        editorialEnabled: settings.view.settings.editorialEnabled,
        providerId: settings.view.settings.providerId,
        modelId: settings.view.settings.modelId,
        webSearchEnabled: settings.view.settings.webSearchEnabled,
        ...(settings.view.settings.webSearchAuthorizedAt ? { webSearchAuthorizedAt: settings.view.settings.webSearchAuthorizedAt } : {})
      }
      setLoaded(next)
      setDraft(next)
      setProviders(modelProviders ?? [])
      setDefaultModel(await readDefaultModel(modelProviders ?? []))
      setWebSearchSupported(settings.view.webSearchSupported)
      setState('ready')
    })()
    return () => { active = false }
  }, [input.client, reloadKey, input.enabled])

  const candidates = useMemo<ModelPickerCandidate[]>(
    () => providers.flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, model }))),
    [providers]
  )

  return {
    state,
    saving,
    draft,
    providers,
    candidates,
    defaultModel,
    webSearchSupported,
    webSearchBlocked,
    clearWebSearchBlocked() { setWebSearchBlocked(false) },
    dirty: Boolean(draft && loaded && JSON.stringify(draft) !== JSON.stringify(loaded)),
    update(patch) { setDraft((current) => current ? { ...current, ...patch } : current) },
    reload() { setReloadKey((count) => count + 1) },
    async save() {
      if (!draft) return false
      setSaving(true)
      try {
        // A switch that would spend requests needs a usable search provider: refuse rather than
        // save a preference the next run would silently drop.
        if (draft.webSearchEnabled && !(await webSearchReady())) {
          setWebSearchBlocked(true)
          return false
        }
        const result = await input.client.saveSettings(draft)
        if (result.state === 'available') {
          // The saved values are the new baseline: without this, a successful save followed by a
          // close would ask "discard your changes?" about edits that are already stored.
          setLoaded(draft)
          setState('ready')
          return true
        }
        setState('save-failed')
        return false
      } catch {
        setState('save-failed')
        return false
      } finally {
        setSaving(false)
      }
    }
  }
}

async function readDefaultModel(providers: readonly SafeModelProvider[]): Promise<{ providerId: string; modelId: string; providerName: string; modelName: string } | null> {
  try {
    const settings = await window.platform?.settings?.get() as { modelDefaults?: { agentModelId?: unknown } } | undefined
    const value = settings?.modelDefaults?.agentModelId
    if (typeof value !== 'string' || !value) return null
    const resolved = resolveConfiguredModel({
      value,
      providers,
      isModelAcceptable: (_provider, model) => model.capabilities.chat === true
    })
    return resolved.ok
      ? { providerId: resolved.ref.providerId, modelId: resolved.ref.modelId, providerName: resolved.providerName, modelName: resolved.modelName }
      : null
  } catch {
    return null
  }
}

async function webSearchReady(): Promise<boolean> {
  const api = window.platform?.webSearch
  if (!api) return false
  try {
    const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()])
    const rows = providers as Array<{ id: string; enabled: boolean; hasApiKey: boolean }>
    const search = rows.find((row) => row.id === settings.defaultSearchProviderId)
    const fetch = rows.find((row) => row.id === settings.defaultFetchProviderId)
    return Boolean(search?.enabled && (search.id === 'fetch' || search.hasApiKey) && fetch?.enabled)
  } catch { return false }
}

