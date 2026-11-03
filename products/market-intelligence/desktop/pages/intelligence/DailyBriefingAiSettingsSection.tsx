import { Switch } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { parseConfiguredModelRef, resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import { supportsAnthropicServerWebSearch } from '@platform/ai/providers/providerServerTools'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingText } from './dailyBriefingText'

const MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

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
      setDraft({
        editorialEnabled: settings.view.settings.editorialEnabled,
        providerId: settings.view.settings.providerId,
        modelId: settings.view.settings.modelId,
        webSearchEnabled: settings.view.settings.webSearchEnabled,
        ...(settings.view.settings.webSearchAuthorizedAt ? { webSearchAuthorizedAt: settings.view.settings.webSearchAuthorizedAt } : {})
      })
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

/** The AI editing block's content. Content only — the host supplies the cancel/save pair. */
export function DailyBriefingAiSettingsSection({ text, ...state }: Readonly<{
  text: DailyBriefingText
}> & Omit<DailyBriefingAiSettingsState, 'saving' | 'save' | 'reload'>): React.ReactElement {
  const language = useShellLanguage()
  const { draft, defaultModel, providers, candidates, webSearchSupported, webSearchBlocked, update } = state

  if (state.state === 'load-failed') {
    return <p className="mi-daily-briefing__settings-error" role="alert">{text.aiSettings.failed}</p>
  }
  if (state.state === 'loading' || !draft) {
    return <LoadingState label={text.aiSettings.loading} minHeight={90} />
  }

  const followsDefault = Boolean(defaultModel && draft.providerId === defaultModel.providerId && draft.modelId === defaultModel.modelId)
  const pickerValue = draft.providerId && draft.modelId && !followsDefault ? `${draft.providerId}:${draft.modelId}` : null
  const followLabel = defaultModel
    ? `${text.aiSettings.followDefault} · ${defaultModel.providerName} / ${defaultModel.modelName}`
    : text.aiSettings.followDefault

  // Every form control in this block belongs to the brief's own settings; the drawer's
  // acceptance gate counts "form controls == controls under a declared scope" and flags the rest.
  return <div data-setting-scope="brief">
    <div className="mi-daily-briefing__settings-row">
      <div>
        <strong>{text.aiSettings.enabled}</strong>
        <small>{text.aiSettings.enabledHint}</small>
      </div>
      <Switch checked={draft.editorialEnabled} onChange={(editorialEnabled) => update({ editorialEnabled })} />
    </div>
    <div className="mi-daily-briefing__settings-row">
      <div><strong>{text.aiSettings.webSearch}</strong><small>{text.aiSettings.webSearchHint}</small></div>
      <div className="mi-daily-briefing-ai__websearch">
        <Switch checked={draft.webSearchEnabled} onChange={(checked) => {
          state.clearWebSearchBlocked()
          update({
            webSearchEnabled: checked,
            ...(checked && !draft.webSearchAuthorizedAt ? { webSearchAuthorizedAt: new Date().toISOString() } : {})
          })
        }} />
        {webSearchBlocked
          ? <small className="mi-daily-briefing-ai__error">{text.aiSettings.webSearchNeedsSetup}</small>
          : !webSearchSupported ? <small>{text.aiSettings.webSearchUnsupported}</small> : null}
      </div>
    </div>
    {draft.editorialEnabled ? <div className="mi-daily-briefing__settings-row">
      <div>
        <strong>{text.aiSettings.model}</strong>
        <small>{text.aiSettings.modelUnavailable}</small>
      </div>
      <ModelPicker
        pickerId="daily-briefing-ai-settings"
        value={pickerValue}
        onChange={(value: string | null) => {
          const ref = parseConfiguredModelRef(value)
          update({ providerId: ref?.providerId ?? '', modelId: ref?.modelId ?? '' })
        }}
        models={[...candidates]}
        providers={[...providers]}
        labels={platformText[language].models}
        constraints={MODEL_CONSTRAINTS}
        placeholder={followLabel}
        allowClear
        onClear={() => update({ providerId: '', modelId: '' })}
        placement="bottomRight"
      />
    </div> : null}
    {state.state === 'save-failed' ? <p className="mi-daily-briefing__settings-error" role="alert">{text.aiSettings.failed}</p> : null}
  </div>
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
