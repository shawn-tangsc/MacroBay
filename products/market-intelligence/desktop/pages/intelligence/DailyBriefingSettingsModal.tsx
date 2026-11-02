import { Button, Select, Switch } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { parseConfiguredModelRef, resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import { supportsAnthropicServerWebSearch } from '@platform/ai/providers/providerServerTools'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { LoadingState } from '@platform/ui/components/loading'
import { Modal } from '@platform/ui/components/modal'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import { dailyBriefingGenerationPolicy, dailyBriefingGenerationTimes } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'
import type { DailyBriefingText } from './dailyBriefingText'

const MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

type SettingsDraft = Readonly<{
  generationTime: string
  windowHours: number
  editorialEnabled: boolean
  providerId: string
  modelId: string
  webSearchEnabled: boolean
  webSearchAuthorizedAt?: string
}>

/**
 * The one settings panel for the brief: when it runs, how much it covers, and whether a model
 * writes it.
 *
 * These were two dialogs behind two buttons — "generation" and "AI" — and that split forced a
 * reader to know which of the two owned a setting before opening anything. They describe one
 * edition and one save applies to the next edition, so they are one panel with two sections.
 *
 * A save writes both halves in one call: two separate calls could leave a saved schedule next to a
 * rejected model choice, and the reader cannot tell which half took effect.
 */
export function DailyBriefingSettingsModal({ open, text, client, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
}>): React.ReactElement {
  const language = useShellLanguage()
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [providers, setProviders] = useState<readonly SafeModelProvider[]>([])
  const [defaultModel, setDefaultModel] = useState<{ providerId: string; modelId: string; providerName: string; modelName: string } | null>(null)
  // The zone the stored time means, and the value that could not be read. Both come from the save
  // that wrote them; the panel never guesses a zone of its own.
  const [zone, setZone] = useState<string | null>(null)
  const [invalidZone, setInvalidZone] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [webSearchBlocked, setWebSearchBlocked] = useState(false)
  const resolveProductText = useProductTextKey()

  useEffect(() => {
    if (!open) return
    let active = true
    setDraft(null)
    setFailed(false)
    setLoadFailed(false)
    setWebSearchBlocked(false)
    void (async () => {
      const providersPromise = window.platform?.modelProviders?.list
        ? window.platform.modelProviders.list().catch(() => [] as SafeModelProvider[])
        : Promise.resolve([] as SafeModelProvider[])
      const [settings, modelProviders] = await Promise.all([
        client.getSettings().catch(() => undefined),
        providersPromise
      ])
      if (!active) return
      if (!settings || settings.state !== 'available') {
        setLoadFailed(true)
        return
      }
      setZone(settings.view.generation.generationTimeZone ?? null)
      setInvalidZone(settings.view.generation.generationTimeZoneInvalid ?? null)
      setDraft({
        generationTime: settings.view.generation.generationTime,
        windowHours: settings.view.generation.windowHours,
        editorialEnabled: settings.view.settings.editorialEnabled,
        providerId: settings.view.settings.providerId,
        modelId: settings.view.settings.modelId,
        webSearchEnabled: settings.view.settings.webSearchEnabled,
        ...(settings.view.settings.webSearchAuthorizedAt ? { webSearchAuthorizedAt: settings.view.settings.webSearchAuthorizedAt } : {})
      })
      setProviders(modelProviders ?? [])
      setDefaultModel(await readDefaultModel(modelProviders ?? []))
    })()
    return () => { active = false }
  }, [open, client])

  const candidates = useMemo<ModelPickerCandidate[]>(
    () => providers.flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, model }))),
    [providers]
  )
  const followsDefault = Boolean(defaultModel && draft?.providerId === defaultModel.providerId && draft?.modelId === defaultModel.modelId)
  const pickerValue = draft?.providerId && draft.modelId && !followsDefault ? `${draft.providerId}:${draft.modelId}` : null
  const followLabel = defaultModel
    ? `${text.aiSettings.followDefault} · ${defaultModel.providerName} / ${defaultModel.modelName}`
    : text.aiSettings.followDefault
  /**
   * The switch follows the model that will actually run the editor agent. A custom model is
   * resolved against the same provider capability as the runtime: an endpoint without Anthropic
   * server-side web tools would answer `400 tools.0.input_schema`.
   */
  const draftWebSearchSupported = useMemo(() => {
    const providerId = draft?.providerId || defaultModel?.providerId
    if (!providerId) return false
    const provider = providers.find((item) => item.id === providerId)
    return provider ? supportsAnthropicServerWebSearch(provider) : false
  }, [draft?.providerId, defaultModel?.providerId, providers])

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setFailed(false)
    if (draft.webSearchEnabled && !(await webSearchReady())) {
      setWebSearchBlocked(true)
      setSaving(false)
      return
    }
    try {
      const result = await client.saveSettings({
        generation: { generationTime: draft.generationTime, windowHours: draft.windowHours },
        editorialEnabled: draft.editorialEnabled,
        providerId: draft.providerId,
        modelId: draft.modelId,
        webSearchEnabled: draft.webSearchEnabled,
        ...(draft.webSearchAuthorizedAt ? { webSearchAuthorizedAt: draft.webSearchAuthorizedAt } : {})
      })
      if (result.state === 'available') onClose()
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    footer={<>
      <Button onClick={onClose}>{text.generationSettings.cancel}</Button>
      <Button disabled={!draft || loadFailed} loading={saving} onClick={() => void save()} type="primary">
        {saving ? text.generationSettings.saving : text.generationSettings.save}
      </Button>
    </>}
    layer="over-drawer"
    onClose={onClose}
    open={open}
    resolveText={resolveProductText}
    titleKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.title"
    width="standard"
  >
    {!draft ? <LoadingState label={text.generationSettings.loading} minHeight={120} /> : <>
      <h3 className="mi-daily-briefing__settings-section">{text.settings.generation}</h3>
      <div className="mi-daily-briefing__settings-row">
        <div>
          <strong>{text.generationSettings.generationTime}</strong>
          <small>{text.generationSettings.generationTimeHint}</small>
        </div>
        <div className="mi-daily-briefing__settings-time">
          <Select
            aria-label={text.generationSettings.generationTime}
            value={draft.generationTime}
            onChange={(generationTime: string) => setDraft((current) => current ? { ...current, generationTime } : current)}
            options={dailyBriefingGenerationTimes.map((value) => ({ value, label: value }))}
            style={{ width: 108 }}
          />
          {/* The time is only half of the setting: 08:05 means 08:05 in this zone, and saying which
              zone is what keeps one day from producing two editions. */}
          {zone ? <span className="mi-daily-briefing__settings-zone" data-time-zone={zone}>{formatShellTimeZoneLabel(zone)}</span> : null}
        </div>
      </div>
      {invalidZone ? <p className="mi-daily-briefing__settings-warning" role="status">{text.generationSettings.invalidTimeZone.replace('{zone}', invalidZone)}</p> : null}
      <div className="mi-daily-briefing__settings-row">
        <div>
          <strong>{text.generationSettings.windowHours}</strong>
          <small>{text.generationSettings.windowHoursHint}</small>
        </div>
        <Select
          aria-label={text.generationSettings.windowHours}
          value={draft.windowHours}
          onChange={(windowHours: number) => setDraft((current) => current ? { ...current, windowHours } : current)}
          options={dailyBriefingGenerationPolicy.windowHoursOptions.map((hours) => ({
            value: hours,
            label: text.generationSettings.windowHoursOption.replace('{hours}', String(hours))
          }))}
          style={{ width: 128 }}
        />
      </div>

      <h3 className="mi-daily-briefing__settings-section">{text.settings.ai}</h3>
      <div className="mi-daily-briefing__settings-row">
        <div>
          <strong>{text.aiSettings.enabled}</strong>
          <small>{text.aiSettings.enabledHint}</small>
        </div>
        <Switch checked={draft.editorialEnabled} onChange={(editorialEnabled) => setDraft((current) => current ? { ...current, editorialEnabled } : current)} />
      </div>
      <div className="mi-daily-briefing__settings-row">
        <div><strong>{text.aiSettings.webSearch}</strong><small>{text.aiSettings.webSearchHint}</small></div>
        <div className="mi-daily-briefing-ai__websearch">
          <Switch checked={draft.webSearchEnabled} onChange={(checked) => {
            setWebSearchBlocked(false)
            setDraft({ ...draft, webSearchEnabled: checked, ...(checked && !draft.webSearchAuthorizedAt ? { webSearchAuthorizedAt: new Date().toISOString() } : {}) })
          }} />
          {webSearchBlocked
            ? <small className="mi-daily-briefing-ai__error">{text.aiSettings.webSearchNeedsSetup}</small>
            : !draftWebSearchSupported ? <small>{text.aiSettings.webSearchUnsupported}</small> : null}
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
            setDraft((current) => current ? { ...current, providerId: ref?.providerId ?? '', modelId: ref?.modelId ?? '' } : current)
          }}
          models={candidates}
          providers={providers}
          labels={platformText[language].models}
          constraints={MODEL_CONSTRAINTS}
          placeholder={followLabel}
          allowClear
          onClear={() => setDraft((current) => current ? { ...current, providerId: '', modelId: '' } : current)}
          placement="bottomRight"
        />
      </div> : null}
      <p className="mi-daily-briefing__settings-link">
        <button type="button" onClick={() => { openModelSettings(); onClose() }}>{text.aiSettings.openModelSettings}</button>
      </p>
      <p className="mi-daily-briefing__settings-note">{text.generationSettings.note}</p>
      {failed || loadFailed ? <p className="mi-daily-briefing__settings-error" role="alert">{text.generationSettings.failed}</p> : null}
    </>}
  </Modal>
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
