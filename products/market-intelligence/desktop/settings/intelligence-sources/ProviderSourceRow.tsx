import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import type { CollectionPolicyLabels } from './CollectionPolicySection'
import type { SourceDetailRead, SourceHealthLabels } from './SourceHealthDetail'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'
import { SourceEnabledRow } from './SourceRows'
import { SourceDetailsBlock } from './SourceDetailsBlock'

/**
 * 「一个源一行」：启用行（只读状态）+ 行尾「高级」展开后的那张表单。
 *
 * 从 `ProviderDetail` 抽出来的原因只有一个：那个文件越过 500 行硬线，而这段是**一个完整概念**
 * （一个源自己的两行），props 全是父层已有的数据与回调，不新造状态、不改任何行为。
 * 页头（整组开关）与凭据块仍留在 `ProviderDetail`——它们属于「这个供应商」，不属于某一个源。
 */
const NOT_CONFIGURABLE_ARIA_KEY = 'settings.intelligenceSources.collectionPolicy.notConfigurableAria'
const COLLECTION_POLICY_STOPPED_KEY = 'settings.intelligenceSources.collectionPolicyStopped'
const PLANNED_NOT_CONFIGURABLE_KEY = 'settings.intelligenceSources.collectionPolicy.plannedNotConfigurable'

export type ProviderSourceRowPolicy = Readonly<{
  profiles: Readonly<Record<string, IntelligenceSourceProfile>>
  labels: CollectionPolicyLabels
  supportsSentimentById: Readonly<Record<string, boolean>>
  onChange: (sourceId: string, patch: Partial<IntelligenceSourceProfile>) => void
}>

export function ProviderSourceRow(props: Readonly<{
  source: SourceView
  labels: ProviderDetailLabels
  /** 需要 API Key 的源，Key 没配好之前开关灰着（判据在服务层）。 */
  credentialMissing: boolean
  /** 行尾「高级」是否展开。 */
  expanded: boolean
  /** 「高级」按钮 `aria-controls` 指过来的容器 id。 */
  detailsId: string
  onToggleAdvanced: () => void
  onToggle: (enabled: boolean) => void
  proxyConfigured: boolean
  resolveText: (key: string) => string
  policy?: ProviderSourceRowPolicy
  read: SourceDetailRead
  onRetry: () => void
  refreshStale: boolean
  /** 按源跑一次；父层没给这个入口时，四格只回答「能不能」，不画按钮。 */
  onRunNow?: () => Promise<SourceRunOutcome>
  supportsRunNow?: boolean
  timeZone: string
  healthLabels: SourceHealthLabels
}>): React.ReactElement {
  const { source, labels } = props
  const name = labels.sourceNames[source.sourceId] ?? source.displayName
  const unused = source.panels.length === 0
  const unavailable = source.unavailable
  /* meta 只放**读者要判断的东西**：未接入 / 高级这类可见性，以及后面的运行/代理状态。
     「看板 / 日历 / 舆情」这种**面板用途**不进 meta（用户 2026-11-10）。 */
  const tags = [
    unused || source.visibility === 'pending'
      ? labels.badges.pending
      : source.visibility === 'advanced'
        // 「已启用／已停用」不进标签行：开关就在行尾，词说的是开关位置。
        ? labels.badges.advanced
        : null
  ].filter((tag): tag is string => Boolean(tag))
  const profile = props.policy?.profiles[source.sourceId]
  return <div className="source-provider-detail__block">
    <SourceEnabledRow
      /* 需要 API Key 的源，Key 没配好之前开关灰着（判据在服务层：`hasCredential`）。
         界面只画，不自己造默认值——投影给什么 `enabled` 就画什么。 */
      /* 组开关（页头最右那颗）是**唯一可编辑入口**：能力行的开关只读展示这个源自己开没开，
         点了不发写请求。「某一格用不用它」是「采集与数据」那面的题，不在这面出现。 */
      readOnlyEnabled
      {...(props.credentialMissing ? { credentialMissing: true } : {})}
      {...(source.enabled
        ? {
          advanced: {
            controlsId: props.detailsId,
            expanded: props.expanded,
            onToggle: props.onToggleAdvanced
          }
        }
        /* 未启用的源不出现「高级」：没有采集在进行，展开看四行没有意义（用户 2026-11-10）。
           整颗不渲染——不是禁用、不是灰掉、也不占位。 */
        : {})}
      labels={labels}
      name={name}
      onToggle={props.onToggle}
      proxyConfigured={props.proxyConfigured}
      resolveText={props.resolveText}
      source={source}
      tags={tags}
      unavailable={Boolean(unavailable)}
    />
    {/* 展开后那张表单（健康四行 + 采集策略两行）：默认收起，靠行尾那颗「高级」开。 */}
    <SourceDetailsBlock
      automaticSyncStopped={labels.automaticSyncStopped}
      collectionPolicy={props.policy !== undefined && profile !== undefined
        ? {
          configurable: source.collection !== 'none' && source.visibility !== 'pending' && !unavailable,
          enabledConfigurable: source.visibility !== 'pending' && !unavailable,
          labels: props.policy.labels,
          notConfigurable: unavailable
            ? { ariaLabelKey: NOT_CONFIGURABLE_ARIA_KEY, labelKey: COLLECTION_POLICY_STOPPED_KEY }
            : source.visibility === 'pending'
              ? { ariaLabelKey: NOT_CONFIGURABLE_ARIA_KEY, labelKey: PLANNED_NOT_CONFIGURABLE_KEY }
              : undefined,
          onChange: (patch) => props.policy!.onChange(source.sourceId, patch),
          profile,
          supportsSentiment: props.policy.supportsSentimentById[source.sourceId] === true
        }
        : undefined}
      healthLabels={props.healthLabels}
      hidden={!props.expanded}
      id={props.detailsId}
      {...(props.onRunNow === undefined ? {} : { onRunNow: () => props.onRunNow!() })}
      onRetry={props.onRetry}
      read={props.read}
      refreshStale={props.refreshStale}
      resolveText={props.resolveText}
      source={source}
      {...(props.supportsRunNow === undefined ? {} : { supportsRunNow: props.supportsRunNow })}
      timeZone={props.timeZone}
    />
  </div>
}
