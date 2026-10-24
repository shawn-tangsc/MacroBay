import { useEffect, useMemo, useState } from 'react'
import { Modal, Select, Switch } from 'antd'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { NewsSentimentSettingsView } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { intelligenceTranslationClient } from '../../../shared/ipc/intelligenceTranslationClient'
import { openIntelligenceSourcesSettings } from '../../../shared/navigation/productShellNavigation'
import type { NewsSentimentText } from './NewsSentimentCard'

export function NewsSentimentSettingsModal(props: {
  open: boolean
  text: NewsSentimentText
  client: Pick<NewsSentimentClient, 'getSettings' | 'saveSettings'>
  onClose: () => void
}): React.ReactElement {
  const { text } = props
  const [view, setView] = useState<NewsSentimentSettingsView>()
  const [enabled, setEnabled] = useState(true)
  const [modelRef, setModelRef] = useState('')
  const [providers, setProviders] = useState<SafeModelProvider[]>([])
  const [translationEnabled, setTranslationEnabled] = useState<boolean>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreNotice, setRescoreNotice] = useState<string>()

  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    void Promise.all([
      props.client.getSettings(),
      Promise.resolve(window.platform?.modelProviders?.list() as Promise<SafeModelProvider[]> | undefined),
      intelligenceTranslationClient.getSettings().catch(() => undefined)
    ])
      .then(([next, models, translation]) => {
        if (cancelled) return
        setView(next)
        setEnabled(next.settings.modelScoringEnabled)
        setModelRef(next.settings.providerId && next.settings.modelId ? `${next.settings.providerId}:${next.settings.modelId}` : '')
        setProviders(models ?? [])
        setTranslationEnabled(translation?.autoTranslateEnabled)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [props.open, props.client])

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
      cancelText={text.settingsModal.cancel}
      okText={text.settingsModal.save}
      okButtonProps={{ loading: saving }}
      onCancel={props.onClose}
      onOk={() => void save()}
      open={props.open}
      title={text.settingsModal.title}
      zIndex={1400}
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
        <div className="mi-news-settings__row">
          <span>{text.settingsModal.translation.label}</span>
          <span className="mi-news-settings__hint">
            {translationEnabled === undefined
              ? '—'
              : translationEnabled ? text.settingsModal.translation.on : text.settingsModal.translation.off}
          </span>
          <button className="mi-news-settings__link" onClick={() => openIntelligenceSourcesSettings()} type="button">
            {text.settingsModal.translation.open}
          </button>
        </div>
        <div className="mi-news-settings__row">
          <span>{text.settingsModal.rescore}</span>
          <button
            className="mi-news-settings__link"
            disabled={rescoring}
            onClick={() => {
              setRescoring(true)
              setRescoreNotice(undefined)
              void props.client.rescore()
                .then(() => setRescoreNotice(text.settingsModal.rescored))
                .catch(() => setRescoreNotice(text.settingsModal.rescoreFailed))
                .finally(() => setRescoring(false))
            }}
            type="button"
          >
            {rescoring ? text.settingsModal.rescoring : text.settingsModal.rescore}
          </button>
        </div>
        {rescoreNotice ? <p className="mi-news-settings__hint" role="status">{rescoreNotice}</p> : null}
        <p className="mi-news-settings__hint">{text.settingsModal.hint}</p>
        {error ? <p className="mi-news-settings__error" role="alert">{text.settingsModal.failed}</p> : null}
      </div>
    </Modal>
  )
}
