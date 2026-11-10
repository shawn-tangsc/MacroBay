import { Select, Switch } from 'antd'

import { SettingsRow } from '@platform/ui/components/settings-row'
import { StatusPill } from '@platform/ui/components/status-pill'

import { SettingsInfo } from '../settingsInfo'
import { healthStateBadge } from './sourceHealthTone'
import { SETTING_OPTION_SETS, type SettingOptionsSource } from '../../shared/settings/descriptorTypes'
import { SOURCE_ROW_TEMPLATES, sourceRowInstanceKey, sourceRowView } from './sourceSettingRows'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { CollectionPolicyLabels } from './CollectionPolicySection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceHealthState, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 菜单 1 的三行：**行长什么样住在这里，行的值/可见性/写入来自 `menus/sources.ts` 的声明**。
 *
 * 为什么不用通用设置行组件：来源行有自己的形状（列表行、状态药丸、行尾开关、条件 ⓘ、下拉下方的
 * 手动模式注解），塞进通用组件就得替它加一批形状开关——那是把特例装进通用件。所以这里是
 * 「自己的行组件 + 声明是唯一事实源」：值走 `read.select(view)`、可见性走 `visibleWhen`、
 * 行键走 `keyedBy` 模板；页面不再按 key 手写 if，也不再自己读字段。
 *
 * 写入仍只有一条路：三个回调都来自宿主（页面 hook），本文件零 IPC。
 */

/** 一个源要不要报「自动任务」那一格（没有自动采集能力的源不谈任务）。 */
export function needsJob(source: SourceView): boolean {
  return source.collection === 'adapter'
    || source.collection === 'job'
    || source.kind === 'official-calendar'
    || source.kind === 'market-calendar'
}

function SourceHealthPill({ state, resolveText, unavailable }: {
  state?: SourceHealthState
  resolveText: (key: string) => string
  unavailable: boolean
}): React.ReactElement | null {
  if (unavailable) {
    return <StatusPill labelKey="settings.intelligenceSources.unavailableShort" resolveText={resolveText} tone="muted" />
  }
  const badge = state === undefined ? undefined : healthStateBadge(state)
  if (badge === undefined) return null
  return <StatusPill labelKey={badge.labelKey} resolveText={resolveText} tone={badge.tone} />
}

export type SourceEnabledRowProps = Readonly<{
  source: SourceView
  /** 已解析好的来源名（`sourceNames` 有的用文案，没有的用投影里的名字）。 */
  name: string
  /** 归属与看板（` · ` 串起来的那一行）。 */
  tags: readonly string[]
  /** 「这个源现在取不到」：药丸换 `unavailableShort`，与行尾那颗标同词。 */
  unavailable: boolean
  labels: Pick<ProviderDetailLabels, 'badges' | 'jobRegistered' | 'jobNotRegistered' | 'toggleSource'>
  resolveText: (key: string) => string
  /** 读者配过自定义代理时不再提示「需要代理」。 */
  proxyConfigured: boolean
  onToggle: (enabled: boolean) => void
}>

/**
 * 一个源的**启用行**：名字 · 状态药丸 · 归属标签行 —— 开关。
 * 行名取声明的 `labelText(view)`，开关的值取声明的 `read.select(view)`。
 */
export function SourceEnabledRow(props: SourceEnabledRowProps): React.ReactElement | null {
  const { labels, resolveText, source } = props
  const view = { ...source, displayName: props.name }
  const row = sourceRowView(SOURCE_ROW_TEMPLATES.enabled, view)
  if (!row.visible) return null
  const label = row.descriptor.labelText?.(view) || props.name
  const enabled = row.value === true
  /* 这一行是**列表行**，不是设置行：复制列是 `div`、标签是 `strong`（原来就是这样）。
     所以它自己写这两层，不改通用设置行的形状。 */
  return <div
    className="source-provider-detail__row"
    data-setting-key={sourceRowInstanceKey(SOURCE_ROW_TEMPLATES.enabled, source.sourceId)}
  >
    <div className="source-provider-detail__main">
      <strong>{label}</strong>
      {/* 一行药丸：只报**状态**。原因、上次成功、能不能立刻采都收进下面那四格——
          同一个事实两处说，迟早一处新一处旧。 */}
      <span className="source-provider-detail__status">
        <SourceHealthPill
          state={source.collection === 'none' ? undefined : source.healthState}
          resolveText={resolveText}
          unavailable={props.unavailable} />
      </span>
      {/* 第二行：归属与任务状态。纯文本 ` · ` 串起，不再是一排药丸。 */}
      <span className="source-provider-detail__tags-line">
        {[...new Set(props.tags)].join(' · ')}
        {source.requiresProxy && !props.proxyConfigured ? <><i aria-hidden="true"> · </i><em className="source-provider-detail__proxy">{labels.badges.proxy}</em></> : null}
        {needsJob(source) ? <><i aria-hidden="true"> · </i>{source.jobRegistered ? labels.jobRegistered : labels.jobNotRegistered}</> : null}
      </span>
    </div>
    <Switch
      /* The row's label is the source name; the switch has to say what it does, or a screen
         reader reads the same name twice and cannot tell the two controls apart. */
      aria-label={(enabled ? labels.toggleSource.disable : labels.toggleSource.enable).replace('{name}', label)}
      checked={enabled}
      disabled={source.visibility === 'pending'}
      onChange={props.onToggle}
      /* ui-spec §8.3：开关唯一实现是 antd Switch，统一 small（32×18），默认尺寸不在允许写法内。 */
      size="small"
    />
  </div>
}

const PRODUCT_OWNED_NOTE_KEY = 'settings.intelligenceSources.collectionPolicy.productOwnedNote'
const PRODUCT_OWNED_NOTE_ARIA_KEY = 'settings.intelligenceSources.collectionPolicy.productOwnedNoteAria'

export type SourcePresetRowProps = Readonly<{
  sourceId: string
  profile: IntelligenceSourceProfile
  configurable: boolean
  /** 产品自有采集的源：预设不适用，字段名旁挂一句 ⓘ 说明（正文不留长句）。 */
  productOwned: boolean
  labels: Pick<CollectionPolicyLabels, 'manualPresetNote' | 'presets'>
  resolveText: (key: string) => string
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}>

/**
 * 「采集预设」一行：字段名（产品自有源多一颗 ⓘ）+ 下拉；选「手动」时下拉下方补一句注解。
 * 选项值来自声明（`field.optionsFrom`），句子来自文案表的预设词表。
 */
export function SourcePresetRow(props: SourcePresetRowProps): React.ReactElement | null {
  const view = { sourceId: props.sourceId, profile: props.profile }
  const row = sourceRowView(SOURCE_ROW_TEMPLATES.collectionPreset, view)
  if (!row.visible) return null
  const label = props.resolveText(row.descriptor.copy?.labelKey ?? '')
  const optionsFrom = row.descriptor.field.kind === 'select' ? row.descriptor.field.optionsFrom : undefined
  const options = typeof optionsFrom === 'string'
    ? SETTING_OPTION_SETS[optionsFrom as SettingOptionsSource].map((option) => ({
      value: String(option.value),
      label: props.labels.presets[String(option.value)] ?? ''
    }))
    : []
  return <SettingsRow
    controlWrapperClassName="intelligence-setting-control"
    copyClassName={props.productOwned
      ? 'intelligence-setting-label intelligence-setting-label--with-info'
      : 'intelligence-setting-label'}
    label={<>
      {label}
      {props.productOwned
        ? <SettingsInfo
          ariaLabelKey={PRODUCT_OWNED_NOTE_ARIA_KEY}
          labelKeys={[PRODUCT_OWNED_NOTE_KEY]}
          resolveText={props.resolveText}
        />
        : null}
    </>}
    rowAttributes={{ 'data-setting-key': sourceRowInstanceKey(SOURCE_ROW_TEMPLATES.collectionPreset, props.sourceId) }}
    rowClassName="intelligence-setting-row"
  >
    <div className="intelligence-preset-control">
      <Select
        className="intelligence-select"
        disabled={!props.configurable}
        onChange={(collectionPreset) => props.onChange({ collectionPreset: collectionPreset as IntelligenceSourceProfile['collectionPreset'] })}
        options={options}
        value={typeof row.value === 'string' ? row.value : undefined}
      />
      {row.value === 'manual' ? (
        <p className="intelligence-source-note">{props.labels.manualPresetNote}</p>
      ) : null}
    </div>
  </SettingsRow>
}

export type SourceSentimentRowProps = Readonly<{
  sourceId: string
  profile: IntelligenceSourceProfile
  supportsSentiment: boolean
  disabled: boolean
  resolveText: (key: string) => string
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}>

/**
 * 「纳入情绪分析」一行：静态行名 + 一个小开关。
 * 出现与否由声明的 `visibleWhen`（`view.supportsSentiment`）决定，页面不再另判一次。
 */
export function SourceSentimentRow(props: SourceSentimentRowProps): React.ReactElement | null {
  const view = { sourceId: props.sourceId, profile: props.profile, supportsSentiment: props.supportsSentiment }
  const row = sourceRowView(SOURCE_ROW_TEMPLATES.includeInSentiment, view)
  if (!row.visible) return null
  const label = props.resolveText(row.descriptor.copy?.labelKey ?? '')
  return <SettingsRow
    controlWrapperClassName="intelligence-setting-control"
    copyClassName="intelligence-setting-label"
    label={label}
    rowAttributes={{ 'data-setting-key': sourceRowInstanceKey(SOURCE_ROW_TEMPLATES.includeInSentiment, props.sourceId) }}
    rowClassName="intelligence-setting-row"
  >
    <Switch
      aria-label={label}
      checked={row.value === true}
      disabled={props.disabled}
      onChange={(includeInSentiment) => props.onChange({ includeInSentiment })}
      size="small"
    />
  </SettingsRow>
}
