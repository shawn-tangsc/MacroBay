import { Modal, Switch } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { parseConfiguredModelRef, type ConfiguredModelRef } from '@platform/ai/model-defaults/configuredDefaultModel'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { useMarketAnalysisSettings, type MarketAnalysisSettingsRefusal } from './useMarketAnalysisSettings'

const ANALYSIS_MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

/**
 * The analysis switches, extracted from the timeline so both the timeline mask and the
 * latest-conclusion card can open the same dialog. The dialog is the only writer.
 */
export function MarketAnalysisSettingsDialog(props: {
  open: boolean
  text: MarketAnalysisTimelineText
  onClose: () => void
}): React.ReactElement {
  const { text } = props
  const language = useShellLanguage()
  const settingsState = useMarketAnalysisSettings()
  const [draft, setDraft] = useState<{ enabled: boolean; providerId: string; modelId: string } | null>(null)

  useEffect(() => {
    if (!props.open) return
    setDraft({
      enabled: settingsState.settings?.enabled ?? false,
      providerId: settingsState.settings?.providerId ?? '',
      modelId: settingsState.settings?.modelId ?? ''
    })
  }, [props.open, settingsState.settings])

  const modelCandidates = useMemo<ModelPickerCandidate[]>(
    () => settingsState.providers.flatMap(provider => provider.models.map(model => ({ providerId: provider.id, model }))),
    [settingsState.providers]
  )
  const followsDefault = Boolean(
    settingsState.defaultModel &&
    draft?.providerId === settingsState.defaultModel.providerId &&
    draft?.modelId === settingsState.defaultModel.modelId
  )
  const pickerValue = draft?.providerId && draft.modelId && !followsDefault ? `${draft.providerId}:${draft.modelId}` : null
  const followLabel = settingsState.defaultModel
    ? `${text.followsDefaultPrefix}${settingsState.defaultModel.providerName} / ${settingsState.defaultModel.modelName}`
    : text.modelFollowDefault
  const refusalText = (refusal: MarketAnalysisSettingsRefusal | undefined): string | undefined =>
    refusal === 'model-unconfigured' ? text.refusalModelUnconfigured
      : refusal === 'model-unavailable' ? text.refusalModelUnavailable
        : refusal === 'failed' ? text.refusalFailed
          : undefined

  const submit = async (): Promise<void> => {
    if (!draft) return
    if (await settingsState.save(draft)) props.onClose()
  }

  return (
    <Modal
      cancelText={text.cancel}
      className="mi-analysis-timeline__settings-dialog"
      okText={settingsState.saving ? text.saving : text.save}
      okButtonProps={{ loading: settingsState.saving }}
      onCancel={props.onClose}
      onOk={() => void submit()}
      open={props.open}
      title={text.settingsTitle}
      zIndex={1400}
    >
      <div className="mi-analysis-timeline__settings-row">
        <div>
          <strong>{text.analysisEnabled}</strong>
          <small>{text.analysisEnabledHint}</small>
        </div>
        <Switch
          checked={draft?.enabled ?? false}
          onChange={enabled => setDraft(current => current ? { ...current, enabled } : { enabled, providerId: '', modelId: '' })}
        />
      </div>
      <div className="mi-analysis-timeline__settings-row">
        <div>
          <strong>{text.analysisModel}</strong>
        </div>
        <ModelPicker
          pickerId="market-analysis-settings"
          value={pickerValue}
          onChange={(value: string | null) => {
            const ref: ConfiguredModelRef | null = parseConfiguredModelRef(value)
            setDraft(current => current ? { ...current, providerId: ref?.providerId ?? '', modelId: ref?.modelId ?? '' } : current)
          }}
          models={modelCandidates}
          providers={settingsState.providers}
          labels={platformText[language].models}
          constraints={ANALYSIS_MODEL_CONSTRAINTS}
          placeholder={followLabel}
          allowClear
          onClear={() => setDraft(current => current ? { ...current, providerId: '', modelId: '' } : current)}
          placement="bottomRight"
        />
      </div>
      {refusalText(settingsState.refusal) ? (
        <p role="alert" className="mi-analysis-timeline__settings-error">{refusalText(settingsState.refusal)}</p>
      ) : null}
    </Modal>
  )
}
