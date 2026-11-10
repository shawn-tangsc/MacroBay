import { useEffect, useMemo, useState } from 'react'

import { resolveConfiguredModel } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { IconButton } from '@platform/ui/components/icon-button'
import { InlineNotice } from '@platform/ui/components/inline-notice'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { SettingsRow } from '@platform/ui/components/settings-row'
import { SettingsSection } from '@platform/ui/components/settings-section'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { Info } from 'lucide-react'
import { Button, Select, Switch } from 'antd'

import type { NewsSentimentSettingsView } from '../../../service/intelligence/schema/newsSentiment'
import type { SafeIntelligenceTranslationSettings } from '../../../service/intelligence/schema/intelligenceTranslation'
import { newsSentimentClient } from '../../shared/ipc/newsSentimentClient'
import { openModelSettings } from '../../shared/navigation/productShellNavigation'
import { productText } from '../../shared/i18n/productText'
import { useIntelligenceTranslationSettings } from '../../settings/intelligence-sources/useIntelligenceTranslationSettings'
import './ProcessingSettingsPanel.css'

/**
 * 配置抽屉「内容处理」那一屏：**一个区块一个圆角容器**，容器里的行不再各自带边框/底色，
 * 只用发丝线分隔（用户 2026-11-10：「所有内容，不能有个统一的圆角背景吗？」）。
 *
 * 两个区块：
 * - **翻译偏好**：一行一个字段（自动翻译 / 目标语言 / 翻译模型 / 翻译标题 / 翻译摘要 / 翻译证据摘录），
 *   末行是统计与动作合成的一行（待处理 · 失败 · 已翻译 +「翻译当前筛选结果」）；
 * - **情绪评分**：一行「情绪评分用哪个模型」——开关 + 模型下拉。
 *
 * 这一屏**自己一份实现**，不再借用设置页那张卡（那张卡每个字段一个边框盒子，和抽屉其它屏不像一套）；
 * 设置页那份原样留着，两边互不牵连。数据仍读同一份设置（翻译偏好的 hook、舆情的设置命令）。
 *
 * 四条口径：
 * - 关着只写「规则判断」，**不画灰掉的下拉**——假控件一律不许；
 * - 两处都是**即时保存**（没有草稿态、没有保存按钮），失败当场说、控件留在原值；
 * - 读不到是「未知 / 读不到」+ 原因进 ⓘ，**不落成「规则判断」**；读不到时不给写口；
 * - 行内右侧控件**左缘对齐标签列右边界**（`SettingsRow` 的口径），不是右对齐。
 */
export function ProcessingSettingsPanel(): React.ReactElement {
  const language = useShellLanguage()
  const sourcesText = productText[language].settings.intelligenceSources
  const copy = productText[language].pages.intelligence.portal.dashboard.configDrawer
  // 「再试一次」这一句是共用词表里的那一句（读不到与失败的下一步都指向它），不另写一条。
  const dataText = productText[language].pages.intelligence.portal.data
  const settingsText = productText[language].pages.intelligence.portal.newsSentiment.settingsModal
  const labels = sourcesText.translationPreferences
  const translation = useIntelligenceTranslationSettings(labels)
  const sentiment = useSentimentModelSettings()

  const settings = translation.settings
  const counts = translation.moduleStatus
  const modelOptions = useMemo(() => {
    const providers = translation.modelProviders ?? []
    const models = providers.flatMap((provider) =>
      provider.models
        .filter((model) => model.capabilities.chat)
        .map((model) => ({ value: `${provider.id}:${model.id}`, label: `${provider.name} · ${model.name}` }))
    )
    return [{ value: '', label: buildFollowDefaultLabel(settings, providers, labels) }, ...models]
  }, [labels, settings, translation.modelProviders])

  return <div className="config-drawer-processing" data-processing-panel="true">
    <div data-processing-section="translation">
    <SettingsSection title={labels.title}>
      {translation.loading ? <LoadingState label={labels.loading} minHeight={60} /> : null}
      {!translation.loading && settings === undefined
        ? <SettingsRow
          controlWrapperClassName="config-drawer__value config-drawer__value--with-info"
          copyClassName="config-drawer__label"
          label={labels.moduleStatus}
          rowClassName="config-drawer__row">
          <Unreadable reason={translation.errorMessage ?? labels.loadFailed} />
        </SettingsRow>
        : null}
      {settings === undefined ? null : <>
        <FieldRow label={labels.autoTranslateEnabled} rowKey="autoTranslateEnabled">
          <Switch
            aria-label={labels.autoTranslateEnabled}
            checked={settings.autoTranslateEnabled}
            disabled={translation.saving}
            onChange={(autoTranslateEnabled) => void translation.updateSettings({ autoTranslateEnabled })}
            size="small" />
        </FieldRow>
        <FieldRow label={labels.targetLocale} rowKey="targetLocale">
          <Select
            aria-label={labels.targetLocale}
            disabled={translation.saving}
            onChange={(targetLocale) => void translation.updateSettings({
              targetLocale: targetLocale as SafeIntelligenceTranslationSettings['targetLocale']
            })}
            options={Object.entries(labels.targetLocales).map(([value, label]) => ({ value, label }))}
            size="small"
            value={settings.targetLocale} />
        </FieldRow>
        <FieldRow label={labels.translationModel} rowKey="translationModel">
          <Select
            aria-label={labels.translationModel}
            disabled={translation.saving}
            onChange={(ref) => {
              const [providerId = '', modelId = ''] = String(ref).split(':')
              void translation.updateSettings({ providerId, modelId })
            }}
            options={modelOptions}
            size="small"
            value={settings.providerId && settings.modelId ? `${settings.providerId}:${settings.modelId}` : ''} />
        </FieldRow>
        <FieldRow label={labels.translateTitle} rowKey="translateTitle">
          <Switch
            aria-label={labels.translateTitle}
            checked={settings.translateTitle}
            disabled={translation.saving}
            onChange={(translateTitle) => void translation.updateSettings({ translateTitle })}
            size="small" />
        </FieldRow>
        <FieldRow label={labels.translateSummary} rowKey="translateSummary">
          <Switch
            aria-label={labels.translateSummary}
            checked={settings.translateSummary}
            disabled={translation.saving}
            onChange={(translateSummary) => void translation.updateSettings({ translateSummary })}
            size="small" />
        </FieldRow>
        <FieldRow label={labels.translateEvidenceExcerpt} rowKey="translateEvidenceExcerpt">
          <Switch
            aria-label={labels.translateEvidenceExcerpt}
            checked={settings.translateEvidenceExcerpt}
            disabled={translation.saving}
            onChange={(translateEvidenceExcerpt) => void translation.updateSettings({ translateEvidenceExcerpt })}
            size="small" />
        </FieldRow>
        {/* 统计与动作合成一行：不再三个独立小盒，行尾一颗动作。 */}
        <div className="config-drawer__row" data-drawer-row="translationStats">
          <span className="config-drawer__label">{labels.moduleStatus}</span>
          <span className="config-drawer__value">
            {counts === undefined
              ? <Unreadable reason={translation.errorMessage ?? labels.loadFailed} />
              : `${labels.pendingCount} ${counts.pendingCount}${labels.joiner}${labels.failedCount} ${counts.failedCount}${labels.joiner}${labels.translatedCount} ${counts.translatedCount}`}
          </span>
          <Button
            className="text-action"
            disabled={translation.queuing}
            loading={translation.queuing}
            onClick={() => void translation.queueMissing([])}
            size="small">
            {labels.queueMissing}
          </Button>
        </div>
        {translation.errorMessage === null || translation.errorMessage === undefined
          ? null
          : <InlineNotice tone="danger">{translation.errorMessage}</InlineNotice>}
      </>}
    </SettingsSection>
    </div>

    <div data-processing-section="sentiment">
    <SettingsSection title={copy.groups.sentimentScoring}>
      {/* 两行：开关是「是否用模型判断情绪」的总开关，模型是它打开后才有的第二行。
          关着时只在开关那一行的值位写「规则判断」，不画灰掉的下拉。 */}
      <SettingsRow
        controlWrapperClassName="config-drawer__value"
        copyClassName="config-drawer__label"
        label={<>
          {copy.rows.sentimentModelSwitch}
          {sentiment.state === 'unreadable'
            ? <Popover
              content={<span>{copy.values.sentimentUnknownReason}</span>}
              trigger={(triggerProps) => (
                <IconButton
                  {...triggerProps}
                  ariaLabelKey="configDrawer.rowReason"
                  icon={Info}
                  onSelect={() => undefined}
                  resolveText={(key: string) => (key === 'configDrawer.rowReason' ? copy.values.sentimentUnknownReason : '')}
                  size="sm" />
              )} />
            : null}
        </>}
        rowAttributes={{ 'data-drawer-row': 'sentimentScoring' }}
        rowClassName="config-drawer__row">
        {sentiment.state === 'unreadable' ? <span>{copy.values.autoUnknown}</span> : null}
        {sentiment.state === 'ready'
          ? <Switch
            aria-label={copy.rows.sentimentModelSwitch}
            checked={sentiment.enabled}
            disabled={sentiment.saving}
            onChange={(next) => void sentiment.setEnabled(next)}
            size="small" />
          : null}
        {/* 关着时的状态词跟在开关后面，不占控件列左缘，也不把开关顶到行尾。 */}
        {sentiment.state === 'ready' && !sentiment.enabled
          ? <span>{copy.values.sentimentRuleOnly}</span>
          : null}
      </SettingsRow>
      {sentiment.state === 'ready' && sentiment.enabled
        ? <SettingsRow
          controlWrapperClassName="config-drawer__value"
          copyClassName="config-drawer__label"
          label={copy.rows.sentimentModel}
          rowAttributes={{ 'data-drawer-row': 'sentimentModel' }}
          rowClassName="config-drawer__row">
          <Select
            aria-label={copy.rows.sentimentModel}
            disabled={sentiment.saving}
            onChange={(next) => void sentiment.selectModel(String(next))}
            options={sentimentOptions(sentiment, settingsText)}
            size="small"
            value={sentiment.modelRef} />
        </SettingsRow>
        : null}
      {/* 两条只出一条：保存失败优先（红色），读不到是黄灯——读不到不是失败。 */}
      {sentiment.saveFailed
        ? <InlineNotice
          action={{ labelKey: 'portal.data.retry', onSelect: () => void sentiment.retry() }}
          resolveText={(key) => (key === 'portal.data.retry' ? dataText.retry : key)}
          tone="danger">
          {settingsText.failed}
        </InlineNotice>
        : sentiment.state === 'unreadable'
          ? <InlineNotice
            action={{ labelKey: 'configDrawer.openModelService', onSelect: openModelSettings }}
            resolveText={(key) => (key === 'configDrawer.openModelService' ? copy.openModelService : key)}
            tone="caution">
            {copy.unreadable}
          </InlineNotice>
          : null}
    </SettingsSection>
    </div>
  </div>
}


/** 一行一个字段：标签左、控件右，行间一条发丝线（行本身不再带边框/底色）。 */
function FieldRow(props: Readonly<{ label: string; rowKey: string; children: React.ReactNode }>): React.ReactElement {
  return <SettingsRow
    controlWrapperClassName="config-drawer__value"
    copyClassName="config-drawer__label"
    label={props.label}
    rowAttributes={{ 'data-drawer-row': props.rowKey }}
    rowClassName="config-drawer__row">
    {props.children}
  </SettingsRow>
}

/** 读不到：正文只留状态词，原因进 ⓘ（不画 0、不落成「规则判断」）。 */
function Unreadable(props: Readonly<{ reason: string }>): React.ReactElement {
  return <>
    <span>读不到</span>
    <Popover
      content={<span>{props.reason}</span>}
      trigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ariaLabelKey="configDrawer.rowReason"
          icon={Info}
          onSelect={() => undefined}
          resolveText={(key: string) => (key === 'configDrawer.rowReason' ? props.reason : '')}
          size="sm" />
      )} />
  </>
}


/** 跟随默认模型那一项的说法：没配 / 供应商列表还没到 / 配了但不可用，各说各的。 */
function buildFollowDefaultLabel(
  settings: SafeIntelligenceTranslationSettings | undefined,
  providers: readonly SafeModelProvider[],
  labels: Readonly<{
    followModelServiceDefault: string
    parenOpen: string
    parenClose: string
    defaultModelNotConfigured: string
    defaultModelUnavailable: string
    joiner: string
    modelPathSep: string
  }>
): string {
  if (settings === undefined || providers.length === 0) return labels.followModelServiceDefault
  if (!settings.defaultModelId.trim()) {
    return `${labels.followModelServiceDefault}${labels.parenOpen}${labels.defaultModelNotConfigured}${labels.parenClose}`
  }
  const resolved = resolveConfiguredModel({
    value: settings.defaultModelId,
    providers,
    isModelAcceptable: (_provider, model) => model.capabilities.chat === true
  })
  return resolved.ok
    ? `${labels.followModelServiceDefault}${labels.joiner}${resolved.providerName}${labels.modelPathSep}${resolved.modelName}`
    : `${labels.followModelServiceDefault}${labels.parenOpen}${labels.defaultModelUnavailable}${labels.parenClose}`
}

function sentimentOptions(
  state: Extract<SentimentModelState, { state: 'ready' }>,
  settingsText: Readonly<{ fastUnset: string; followFast: string }>
): { value: string; label: string }[] {
  const models = state.providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.capabilities.chat)
      .map((model) => ({ value: `${provider.id}:${model.id}`, label: `${provider.name} · ${model.name}` }))
  )
  const follow = state.defaultFastName === undefined
    ? settingsText.fastUnset
    : settingsText.followFast.replace('{name}', state.defaultFastName)
  return [{ value: '', label: follow }, ...models]
}

type SentimentModelState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'unreadable' }>
  | Readonly<{
    state: 'ready'
    enabled: boolean
    /** `providerId:modelId`；空串＝跟随快速模型（与设置里 `providerId/modelId` 留空同一含义）。 */
    modelRef: string
    providers: readonly SafeModelProvider[]
    defaultFastName?: string
  }>

type SentimentModelActions = {
  saving: boolean
  saveFailed: boolean
  setEnabled: (next: boolean) => Promise<void>
  selectModel: (ref: string) => Promise<void>
  /** 重放上一次失败的写；没有失败过就是空操作。 */
  retry: () => Promise<void>
}

/**
 * 评分模型那一格：读设置 + 两个写动作（开关、下拉）。**写失败不落成成功**——只有服务返回的
 * `NewsSentimentSettingsView` 说了算，失败就留在原值并当场提示。
 */
function useSentimentModelSettings(): SentimentModelState & SentimentModelActions {
  const [state, setState] = useState<SentimentModelState>({ state: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  /** 失败的那一次写请求；「再试一次」重放它，而不是让读者把开关再拨回去。 */
  const [failedPatch, setFailedPatch] = useState<{ modelScoringEnabled?: boolean; providerId?: string; modelId?: string }>()

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const view = await newsSentimentClient.getSettings()
        const providers = await window.platform?.modelProviders?.list().catch(() => []) as SafeModelProvider[] | undefined
        if (!active) return
        setState(toSentimentModelState(view, providers ?? []))
      } catch {
        if (active) setState({ state: 'unreadable' })
      }
    })()
    return () => { active = false }
  }, [])

  const write = async (patch: { modelScoringEnabled?: boolean; providerId?: string; modelId?: string }): Promise<void> => {
    if (saving || state.state !== 'ready') return
    setSaving(true)
    setSaveFailed(false)
    try {
      const view = await newsSentimentClient.saveSettings(patch)
      setState(toSentimentModelState(view, state.providers))
    } catch {
      setFailedPatch(patch)
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return {
    ...state,
    saving,
    saveFailed,
    setEnabled: (next) => write({ modelScoringEnabled: next }),
    selectModel: (ref) => {
      const [providerId = '', modelId = ''] = ref.split(':')
      return write({ providerId, modelId })
    },
    retry: () => (failedPatch === undefined ? Promise.resolve() : write(failedPatch))
  }
}

function toSentimentModelState(
  view: NewsSentimentSettingsView,
  providers: readonly SafeModelProvider[]
): SentimentModelState {
  const defaultFastName = view.defaultFastModel?.name
  if (!view.settings.modelScoringEnabled) {
    return { state: 'ready', enabled: false, modelRef: '', providers, defaultFastName }
  }
  const { resolution } = view
  if (resolution.source === 'platform-fast') {
    return { state: 'ready', enabled: true, modelRef: '', providers, defaultFastName }
  }
  if (resolution.source === 'explicit') {
    const provider = providers.find((candidate) => candidate.id === resolution.providerId)
    const model = provider?.models.find((candidate) => candidate.id === resolution.modelId)
    // 选了模型却翻不出名字（供应商停用、模型下架）：说「读不到」，不冒充跟随、也不显示裸 id。
    if (model === undefined) return { state: 'unreadable' }
    return {
      state: 'ready',
      enabled: true,
      modelRef: `${resolution.providerId ?? ''}:${resolution.modelId ?? ''}`,
      providers,
      defaultFastName
    }
  }
  return { state: 'unreadable' }
}
