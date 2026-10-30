import { Modal, Switch } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { parseConfiguredModelRef, resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'
import type { DailyBriefingText } from './dailyBriefingText'

const MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

/**
 * The one writer of the brief's editorial preference. The default stays "follow the platform
 * default"; a custom model is a deliberate choice, and a disabled switch keeps the fact layer.
 */
export function DailyBriefingAiSettingsModal({ open, text, client, onClose }: Readonly<{
  open: boolean
  text: DailyBriefingText
  client: Pick<DailyBriefingClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
}>): React.ReactElement {
  const language = useShellLanguage()
  const [draft, setDraft] = useState<{ editorialEnabled: boolean; providerId: string; modelId: string; webSearchEnabled: boolean; webSearchAuthorizedAt?: string } | null>(null)
  const [providers, setProviders] = useState<readonly SafeModelProvider[]>([])
  const [defaultModel, setDefaultModel] = useState<{ providerId: string; modelId: string; providerName: string; modelName: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [webSearchBlocked, setWebSearchBlocked] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setDraft(null)
    setFailed(false)
    setLoadFailed(false)
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
      setDraft({
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
      const result = await client.saveSettings(draft)
      if (result.state === 'available') onClose()
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    open={open}
    title={text.aiSettings.title}
    onCancel={onClose}
    onOk={() => void save()}
    okText={saving ? text.aiSettings.saving : text.aiSettings.save}
    cancelText={text.aiSettings.cancel}
    okButtonProps={{ loading: saving, disabled: !draft || loadFailed }}
    zIndex={1500}
  >
    {!draft ? <LoadingState label={text.aiSettings.loading} minHeight={90} /> : <>
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
          <Switch checked={draft.webSearchEnabled} onChange={(checked) => { setWebSearchBlocked(false); setDraft({ ...draft, webSearchEnabled: checked, ...(checked && !draft.webSearchAuthorizedAt ? { webSearchAuthorizedAt: new Date().toISOString() } : {}) }) }} />
          {webSearchBlocked ? <small className="mi-daily-briefing-ai__error">{text.aiSettings.webSearchNeedsSetup}</small> : null}
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
      {failed ? <p className="mi-daily-briefing__settings-error" role="alert">{text.aiSettings.failed}</p> : null}
      {loadFailed ? <p className="mi-daily-briefing__settings-error" role="alert">{text.aiSettings.failed}</p> : null}
    </>}
  </Modal>
}

async function readDefaultModel(providers: readonly SafeModelProvider[]): Promise<{ providerId: string; modelId: string; providerName: string; modelName: string } | null> {
  try {
    const settings = await window.platform?.settings?.get() as { modelDefaults?: { assistantModelId?: unknown } } | undefined
    const value = settings?.modelDefaults?.assistantModelId
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
