import { useEffect, useMemo, useState } from 'react'
import { Button, Select, Switch } from 'antd'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { Modal } from '@platform/ui/components/modal'

import type { NewsSentimentSettingsView } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { intelligenceTranslationClient } from '../../../shared/ipc/intelligenceTranslationClient'
import { openIntelligenceSourcesSettings } from '../../../shared/navigation/productShellNavigation'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { NewsSentimentText } from './NewsSentimentCard'

export function NewsSentimentSettingsModal(props: {
  open: boolean
  text: NewsSentimentText
  client: Pick<NewsSentimentClient, 'getSettings' | 'saveSettings' | 'rescore'>
  showTranslation?: boolean
  onClose: () => void
}): React.ReactElement {
  const { text } = props
  const resolveText = useProductTextKey()
  const [view, setView] = useState<NewsSentimentSettingsView>()
  const [enabled, setEnabled] = useState(true)
  const [modelRef, setModelRef] = useState('')
  const [providers, setProviders] = useState<SafeModelProvider[]>([])
  const showTranslation = props.showTranslation !== false
  const [translationEnabled, setTranslationEnabled] = useState<boolean>()
  const [translationModelId, setTranslationModelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    void Promise.all([
      props.client.getSettings(),
      Promise.resolve(window.platform?.modelProviders?.list() as Promise<SafeModelProvider[]> | undefined),
      showTranslation ? intelligenceTranslationClient.getSettings().catch(() => undefined) : Promise.resolve(undefined)
    ])
      .then(([next, models, translation]) => {
        if (cancelled) return
        setView(next)
        setEnabled(next.settings.modelScoringEnabled)
        setModelRef(next.settings.providerId && next.settings.modelId ? `${next.settings.providerId}:${next.settings.modelId}` : '')
        setProviders(models ?? [])
        setTranslationEnabled(translation?.autoTranslateEnabled)
        setTranslationModelId(translation?.defaultModelId ?? '')
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [props.open, props.client, showTranslation])

  const translationModelLabel = useMemo(() => {
    const ref = translationModelId.trim()
    if (!ref) return undefined
    const [providerId, modelId] = ref.split(':')
    const provider = providers.find((entry) => entry.id === providerId)
    const model = provider?.models.find((entry) => entry.id === modelId)
    return model ? `${provider?.name ?? providerId} / ${model.name}` : ref
  }, [providers, translationModelId])

  const options = useMemo(() => {
    const models = providers.flatMap((provider) =>
      provider.models
        .filter((model) => model.capabilities.chat)
        .map((model) => ({ value: `${provider.id}:${model.id}`, label: `${provider.name} · ${model.name}` }))
    )
    const follow = view?.defaultFastModel
      ? text.settingsModal.followFast.replace('{name}', view.defaultFastModel.name)
      : text.settingsModal.fastUnset
    return [{ value: '', label: follow }, ...models]
  }, [providers, text, view])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(false)
    try {
      const [providerId = '', modelId = ''] = modelRef.split(':')
      const next = await props.client.saveSettings({ modelScoringEnabled: enabled, providerId, modelId })
      setView(next)
      props.onClose()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={props.open}
      width="standard"
      layer="over-drawer"
      titleKey="pages.intelligence.portal.newsSentiment.settingsModal.title"
      resolveText={resolveText}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>{text.settingsModal.cancel}</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            {text.settingsModal.save}
          </Button>
        </>
      }
    >
      <div className="mi-news-settings">
        <label className="mi-news-settings__row">
          <span>{text.settingsModal.modelScoring}</span>
          <Switch checked={enabled} onChange={setEnabled} size="small" />
        </label>
        <label className="mi-news-settings__row">
          <span>{text.settingsModal.model}</span>
          <Select
            aria-label={text.settingsModal.model}
            onChange={setModelRef}
            options={options}
            style={{ minWidth: 240 }}
            value={modelRef}
          />
        </label>
        <p className="mi-news-settings__hint">{text.settingsModal.judgeHint}</p>
        {showTranslation ? (
          <>
            <div className="mi-news-settings__row">
              <span>{text.settingsModal.translation.label}</span>
              <span className="mi-news-settings__hint">
                {translationEnabled === undefined
                  ? '—'
                  : translationEnabled ? text.settingsModal.translation.on : text.settingsModal.translation.off}
              </span>
              <Button className="mi-news-settings__link" onClick={() => openIntelligenceSourcesSettings()} size="small" type="link">
                {text.settingsModal.translation.open}
              </Button>
            </div>
            <p className="mi-news-settings__hint">
              {text.settingsModal.translation.modelLabel}: {translationModelLabel ?? text.settingsModal.translation.followDefault}
            </p>
          </>
        ) : null}
        <p className="mi-news-settings__hint">{text.settingsModal.hint}</p>
        {error ? <p className="mi-news-settings__error" role="alert">{text.settingsModal.failed}</p> : null}
      </div>
    </Modal>
  )
}
