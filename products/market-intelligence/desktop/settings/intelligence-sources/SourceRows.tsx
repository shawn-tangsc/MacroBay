import { Switch } from 'antd'

import { StatusPill } from '@platform/ui/components/status-pill'

import { SettingField } from '../../shared/settings/SettingField'
import { healthStateBadge } from './sourceHealthTone'
import { SOURCE_ROW_TEMPLATES, sourceRowDescriptor, sourceRowInstanceKey } from './sourceSettingRows'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { SourceHealthState, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 菜单 1 的行组件：**形状开关（`copyAs` / `labelAs` / `switchSize`）只住在这个文件里**。
 * 它们是 DOM 形状的逃生口，不是设计意图——放在一处，才看得住「同一屏不出现两种行形状」。
 *
 * 现在住这里的两行：逐源启用（`SourceEnabledRow`）、纳入情绪分析（`SourceSentimentRow`）。
 * 采集预设那行等设置行组件能表达它自己的控件列与条件 ⓘ 之后再搬进来。
 */

/**
 * 一个源的**启用行**：名字 · 状态药丸 · 归属标签行 —— 开关。
 *
 * 两条渲染路径共用这一段 JSX（同一份事实不各写一遍）：
 * - 设置页那一面由注册表声明渲染（`setting:sources.enabled@<sourceId>`）：行结构、标签元素、
 *   复制列元素、开关档位都来自那条声明；
 * - 看板/日历那一面仍是旧形状，等 S2 再一起换。
 *
 * 状态药丸只读投影（`SourceView.healthState`），词与色都走 `healthStateBadge` 那处映射；
 * 视图层不拿 `runtimeStatus`/失败数再算一遍。
 */
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
  /** 设置页那一面走注册表声明；看板/日历那一面仍是旧形状。 */
  settingsSurface: boolean
  onToggle: (enabled: boolean) => void
}>

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

export function SourceEnabledRow(props: SourceEnabledRowProps): React.ReactElement {
  const { labels, source, resolveText } = props
  /**
   * 行里的两行补充信息（状态药丸、归属与任务状态）：**两条渲染路径共用一份**。
   * 设置页那一面把它交给注册表行的补充槽，看板/日历那一面塞在标签之后。
   */
  const rowMeta = <>
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
  </>

  if (props.settingsSurface) {
    return <SettingField
      copyAs="div"
      copyClassName="source-provider-detail__main"
      descriptor={sourceRowDescriptor(SOURCE_ROW_TEMPLATES.enabled)}
      disabled={source.visibility === 'pending'}
      instanceKey={sourceRowInstanceKey(SOURCE_ROW_TEMPLATES.enabled, source.sourceId)}
      labelAs="strong"
      meta={rowMeta}
      onChange={(next) => props.onToggle(next === true)}
      resolveOptionLabel={() => ''}
      resolveText={resolveText}
      rowClassName="source-provider-detail__row"
      showHelp={false}
      switchSize="small"
      value={source.enabled}
      view={{ sourceId: source.sourceId, displayName: props.name, enabled: source.enabled }}
    />
  }
  return <div className="source-provider-detail__row">
    <div className="source-provider-detail__main">
      <strong>{props.name}</strong>
      {rowMeta}
    </div>
    <Switch
      /* The row's label is the source name; the switch has to say what it does, or a screen
         reader reads the same name twice and cannot tell the two controls apart. */
      aria-label={(source.enabled ? labels.toggleSource.disable : labels.toggleSource.enable).replace('{name}', props.name)}
      checked={source.enabled}
      disabled={source.visibility === 'pending'}
      onChange={props.onToggle}
      /* ui-spec §8.3：开关唯一实现是 antd Switch，统一 small（32×18），默认尺寸不在允许写法内。 */
      size="small"
    />
  </div>
}

/**
 * 「纳入情绪分析」一行：静态行名 + 一个小开关。
 *
 * 出现与否由声明自己的 `visibleWhen` 决定（`view.supportsSentiment`）——页面不再另判一次，
 * 否则「同一份事实两处判」会先在新源上分叉。值仍是页面/profile 的，组件不持有 IO。
 */
export type SourceSentimentRowProps = Readonly<{
  sourceId: string
  profile: IntelligenceSourceProfile
  supportsSentiment: boolean
  disabled: boolean
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
  resolveText: (key: string) => string
}>

export function SourceSentimentRow(props: SourceSentimentRowProps): React.ReactElement {
  return <SettingField
    controlWrapperClassName="intelligence-setting-control"
    copyClassName="intelligence-setting-label"
    descriptor={sourceRowDescriptor(SOURCE_ROW_TEMPLATES.includeInSentiment)}
    disabled={props.disabled}
    instanceKey={sourceRowInstanceKey(SOURCE_ROW_TEMPLATES.includeInSentiment, props.sourceId)}
    onChange={(next) => props.onChange({ includeInSentiment: next === true })}
    resolveOptionLabel={() => ''}
    resolveText={props.resolveText}
    rowClassName="intelligence-setting-row"
    showHelp={false}
    switchSize="small"
    value={props.profile.includeInSentiment}
    view={{ sourceId: props.sourceId, profile: props.profile, supportsSentiment: props.supportsSentiment }}
  />
}
