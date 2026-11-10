import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { CollectionPolicySection, type CollectionPolicyLabels, type CollectionPolicyNotConfigurable } from './CollectionPolicySection'
import { SourceHealthDetail, type SourceDetailRead, type SourceHealthLabels } from './SourceHealthDetail'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'

/**
 * 一个源展开后的那张**表单**：健康四行 + 采集策略两行，**没有二级标题、没有四格卡片、没有嵌套框**
 * （用户 2026-11-10 第三次定稿：一行一个字段，左标签、右值/控件）。
 *
 * 入口不在这里：源那一行行尾（开关左侧）有一颗「高级」文字按钮，`aria-expanded` / `aria-controls`
 * 挂在它上面、指向这里的容器 id。收起时这一块整体不渲染（`hidden` 由调用方给，id 始终存在）。
 */
export function SourceDetailsBlock(props: {
  /** `aria-controls` 指过来的那个 id：容器必须在收起时也存在于 DOM 里。 */
  id: string
  hidden: boolean
  source: SourceView
  read: SourceDetailRead
  healthLabels: SourceHealthLabels
  automaticSyncStopped: string
  supportsRunNow?: boolean
  refreshStale: boolean
  onRetry: () => void
  onRunNow?: (sourceId: string) => Promise<SourceRunOutcome>
  collectionPolicy?: {
    profile: IntelligenceSourceProfile
    labels: CollectionPolicyLabels
    supportsSentiment: boolean
    configurable: boolean
    enabledConfigurable: boolean
    notConfigurable?: CollectionPolicyNotConfigurable
    onChange: (patch: Partial<IntelligenceSourceProfile>) => void
  }
  resolveText: (key: string) => string
  timeZone: string
}): React.ReactElement {
  return <div className="source-provider-detail__form" hidden={props.hidden} id={props.id}>
    <SourceHealthDetail
      automaticSyncStopped={props.automaticSyncStopped}
      labels={props.healthLabels}
      onRetry={props.onRetry}
      {...(props.onRunNow === undefined ? {} : { onRunNow: props.onRunNow })}
      read={props.read}
      refreshStale={props.refreshStale}
      resolveText={props.resolveText}
      source={props.source}
      {...(props.supportsRunNow === undefined ? {} : { supportsRunNow: props.supportsRunNow })}
      timeZone={props.timeZone}
    />
    {props.collectionPolicy === undefined
      ? null
      : <CollectionPolicySection
        configurable={props.collectionPolicy.configurable}
        sourceId={props.source.sourceId}
        draftProfile={props.collectionPolicy.profile}
        enabledConfigurable={props.collectionPolicy.enabledConfigurable}
        labels={props.collectionPolicy.labels}
        {...(props.collectionPolicy.notConfigurable === undefined
          ? {}
          : { notConfigurable: props.collectionPolicy.notConfigurable })}
        onChange={props.collectionPolicy.onChange}
        resolveText={props.resolveText}
        /* 二级标题不要：展开后直接就是表单行。 */
        showTitle={false}
        supportsSentiment={props.collectionPolicy.supportsSentiment}
      />}
  </div>
}
