import { useEffect, useRef, useState } from 'react'

import { Switch } from 'antd'
import { parseConfiguredModelRef, type ConfiguredModelRef } from '@platform/ai/model-defaults/configuredDefaultModel'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { helpTrigger } from '@platform/ui/components/popover'
import { SettingsRow } from '@platform/ui/components/settings-row'
import { SettingsSection } from '@platform/ui/components/settings-section'
import { platformText } from '@renderer/i18n/platformText'
import { ModelPicker } from '@renderer/shell/components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate, ModelPickerConstraints } from '@renderer/shell/components/ModelPicker/modelPickerOptions'

import { productText } from '../../shared/i18n/productText'
import { useMarketAnalysisSettings, type MarketAnalysisSettingsRefusal } from './useMarketAnalysisSettings'

const ANALYSIS_MODEL_CONSTRAINTS: ModelPickerConstraints = { requireCapabilities: ['chat'] }

type Draft = Readonly<{ enabled: boolean; providerId: string; modelId: string }>

const same = (a: Draft, b: Draft): boolean => a.enabled === b.enabled && a.providerId === b.providerId && a.modelId === b.modelId

/** 宿主把屏上报的三样交给抽屉的底部保存栏。 */
export type AnalysisScreenState = Readonly<{
  dirty: boolean
  saving: boolean
  failure?: string
  save: () => void
}>

/**
 * 配置抽屉「AI 分析」那一屏（样板）：**一个区块 + 两行**，保存交给抽屉底部那条统一保存栏。
 *
 * 版式按 `2026-11-10-drawer-four-screens-redesign.md`：区块标题 13/650；行 44；控件**左缘对齐
 * 标签列的右边界**（不是右对齐——右对齐会让每行控件位置各不相同），控件最大宽 320。
 *
 * 这屏自己的数据自己读（`useMarketAnalysisSettings`），写只有一条：`settingsState.save`。
 * 草稿与已存值分开记，`dirty = 草稿 ≠ 已存值`——**不用布尔当脏状态**，编辑回原样就该消失。
 * 三句拒绝句不占行：放在区块上方的 inline notice 里。
 */
export function AnalysisSettingsPanel({ onState }: Readonly<{
  /** 把「有没有改动 / 保存中 / 失败句 / 保存动作」报给抽屉壳（壳只认这四样，不读数据）。 */
  onState: (state: AnalysisScreenState) => void
}>): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].pages.intelligence.portal.analysisTimeline
  const settingsState = useMarketAnalysisSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)

  // 读到的第一份值就是基线；之后的「已存值」只在保存成功时前进。
  useEffect(() => {
    if (settingsState.settings === undefined) return
    const next = {
      enabled: settingsState.settings.enabled,
      providerId: settingsState.settings.providerId,
      modelId: settingsState.settings.modelId
    }
    setBaseline((current) => current ?? next)
    setDraft((current) => current ?? next)
  }, [settingsState.settings])

  const dirty = draft !== null && baseline !== null && !same(draft, baseline)
  const saving = settingsState.saving
  const refusal: MarketAnalysisSettingsRefusal | undefined = settingsState.refusal

  const onStateRef = useRef(onState)
  useEffect(() => { onStateRef.current = onState })

  const latest = useRef<Draft | null>(null)
  useEffect(() => { latest.current = draft }, [draft])
  const save = (): void => {
    const current = latest.current
    if (current === null) return
    void settingsState.save(current).then((ok) => { if (ok) setBaseline(current) })
  }
  const state: AnalysisScreenState = {
    dirty, saving, save,
    ...(refusal === undefined ? {} : {
      failure: refusal === 'model-unconfigured' ? text.refusalModelUnconfigured
        : refusal === 'model-unavailable' ? text.refusalModelUnavailable
          : text.refusalFailed
    })
  }
  // 上报用 ref 里最新的一份 + 最新的 setter：cleanup 里读到的 state 会过期（那时是上一次渲染的值）。
  const emitted = useRef(state)
  useEffect(() => { emitted.current = state; onState(state) })
  useEffect(() => {
    const report = onStateRef.current
    return () => { report({ ...emitted.current, dirty: false }) }
  }, [])

  const candidates: ModelPickerCandidate[] = settingsState.providers
    .flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, model })))
  const followLabel = settingsState.defaultModel === undefined || settingsState.defaultModel === null
    ? text.modelFollowDefault
    : `${text.followsDefaultPrefix}${settingsState.defaultModel.providerName} / ${settingsState.defaultModel.modelName}`
  const followsDefault = settingsState.defaultModel !== undefined && settingsState.defaultModel !== null &&
    draft?.providerId === settingsState.defaultModel.providerId && draft?.modelId === settingsState.defaultModel.modelId

  return <div className="analysis-settings-screen">
    {refusal === undefined ? null : <p className="analysis-settings-screen__notice" role="status">
      {refusal === 'model-unconfigured' ? text.refusalModelUnconfigured
        : refusal === 'model-unavailable' ? text.refusalModelUnavailable : text.refusalFailed}
    </p>}
    <SettingsSection title={text.settingsTitle}>
      <SettingsRow
        copyClassName="config-drawer__label"
        headClassName="config-drawer__label-head"
        label={<span className="config-drawer__label-with-info">
          <strong>{text.analysisEnabled}</strong>
          {/* 这句必须留着：它说的是「关掉 AI 编辑会失去什么」，读者要知道的后果，不是实现说明。
              正文只留字段名，所以进 ⓘ；别当冗余删掉，删了读者只能靠试。 */}
          {helpTrigger({ text: text.analysisEnabledHint })}
        </span>}
        rowClassName="config-drawer__row"
        controlWrapperClassName="config-drawer__control">
        <Switch
          checked={draft?.enabled ?? false}
          onChange={(enabled) => setDraft((current) => current === null ? current : { ...current, enabled })}
        />
      </SettingsRow>
      <SettingsRow
        copyClassName="config-drawer__label"
        label={<strong>{text.analysisModel}</strong>}
        rowClassName="config-drawer__row"
        controlWrapperClassName="config-drawer__control">
        <ModelPicker
          allowClear
          constraints={ANALYSIS_MODEL_CONSTRAINTS}
          labels={platformText[language].models}
          models={candidates}
          onChange={(value: string | null) => {
            const ref: ConfiguredModelRef | null = parseConfiguredModelRef(value)
            setDraft((current) => current === null ? current : { ...current, providerId: ref?.providerId ?? '', modelId: ref?.modelId ?? '' })
          }}
          onClear={() => setDraft((current) => current === null ? current : { ...current, providerId: '', modelId: '' })}
          pickerId="drawer-analysis-settings"
          placeholder={followsDefault ? followLabel : text.modelFollowDefault}
          placement="bottomRight"
          providers={settingsState.providers}
          value={draft?.providerId && draft.modelId && !followsDefault ? `${draft.providerId}:${draft.modelId}` : null}
        />
      </SettingsRow>
    </SettingsSection>
  </div>
}
