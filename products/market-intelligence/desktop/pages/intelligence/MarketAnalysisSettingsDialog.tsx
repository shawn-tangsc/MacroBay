import { Button, Switch } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseConfiguredModelRef, type ConfiguredModelRef } from '@platform/ai/model-defaults/configuredDefaultModel'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { Modal } from '@platform/ui/components/modal'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { useMarketAnalysisSettings, type MarketAnalysisSettingsRefusal } from './useMarketAnalysisSettings'

const ANALYSIS_MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

/** 标题键只在本调用点出现一次；句子由产品的文案表给，组件只认键。 */
const ANALYSIS_SETTINGS_TITLE_KEY = 'mi.analysis.settingsTitle'

/**
 * The analysis switches, extracted from the timeline so both the timeline mask and the
 * latest-conclusion card can open the same dialog. The dialog is the only writer.
 */
/** 分析设置表单里的那一份草稿；与「读到/存下的值」比较判断有没有未保存改动。 */
type AnalysisDraft = Readonly<{ enabled: boolean; providerId: string; modelId: string }>

function analysisDraftOf(settings: Readonly<{ enabled: boolean; providerId: string; modelId: string }> | undefined): AnalysisDraft {
  return {
    enabled: settings?.enabled ?? false,
    providerId: settings?.providerId ?? '',
    modelId: settings?.modelId ?? ''
  }
}

function sameAnalysisDraft(a: AnalysisDraft, b: AnalysisDraft): boolean {
  return a.enabled === b.enabled && a.providerId === b.providerId && a.modelId === b.modelId
}

export function MarketAnalysisSettingsDialog(props: {
  open: boolean
  text: MarketAnalysisTimelineText
  onClose: () => void
  /**
   * `modal`（默认）= 原样：遮罩 + 标题 + 页脚按钮。
   * `inline` = **同一段内容不套 Modal**（产品内「配置」抽屉那一屏用它）：没有遮罩、没有第二个标题、
   * 不自己加外边距，开关/说明/模型/保存/取消一样不少。两个外壳共用下面这一段实现，写入口只有一条。
   */
  variant?: 'modal' | 'inline'
}): React.ReactElement {
  const { text } = props
  const language = useShellLanguage()
  const settingsState = useMarketAnalysisSettings()
  const [draft, setDraft] = useState<AnalysisDraft | null>(null)
  // 草稿上一次接受的基线：读到的值，或刚保存成功的值。判断「本地有没有未保存的改动」只靠它。
  const [baseline, setBaseline] = useState<AnalysisDraft | null>(null)
  // effect 只读最新的草稿与基线，**不把它们放进依赖**：否则 setState 会自己把自己再触发一遍。
  const latestDraft = useRef<{ draft: AnalysisDraft | null; baseline: AnalysisDraft | null }>({ draft: null, baseline: null })
  useEffect(() => { latestDraft.current = { draft, baseline } }, [draft, baseline])

  useEffect(() => {
    if (!props.open) return
    const next = analysisDraftOf(settingsState.settings)
    const { draft: local, baseline: base } = latestDraft.current
    // 另一处保存会广播回来、重新读设置（`useMarketAnalysisSettings` 的 listeners）。读者手上还有
    // 未保存的改动时，外部值不许覆盖它——那不是「同步」，是把人正在写的东西静默丢掉。
    if (local !== null && base !== null && !sameAnalysisDraft(local, base)) return
    setDraft(next)
    setBaseline(next)
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
    if (await settingsState.save(draft)) {
      // 保存成功的值就是新的基线：否则这次保存之后仍算「有未保存改动」，关窗会误拦。
      setBaseline(draft)
      props.onClose()
    }
  }

  const footer = <>
    <Button onClick={props.onClose}>{text.cancel}</Button>
    <Button type="primary" loading={settingsState.saving} onClick={() => void submit()}>
      {settingsState.saving ? text.saving : text.save}
    </Button>
  </>

  const body = <>
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
  </>

  // 内联外壳：同一个 body + 同一套按钮，只是不套 Modal（抽屉自己有标题与容器）。
  if (props.variant === 'inline') {
    return <div className="mi-analysis-timeline__settings-inline" data-analysis-settings-inline="true">
      {body}
      <div className="mi-analysis-timeline__settings-inline-actions">{footer}</div>
    </div>
  }

  return (
    <Modal
      open={props.open}
      width="standard"
      titleKey={ANALYSIS_SETTINGS_TITLE_KEY}
      resolveText={(key) => (key === ANALYSIS_SETTINGS_TITLE_KEY ? text.settingsTitle : '')}
      onClose={props.onClose}
      className="mi-analysis-timeline__settings-dialog"
      // 骨架不内置主按钮：保存/取消由调用方给，顺序与原 antd 默认页脚一致。
      footer={footer}>
      {body}
    </Modal>
  )
}
