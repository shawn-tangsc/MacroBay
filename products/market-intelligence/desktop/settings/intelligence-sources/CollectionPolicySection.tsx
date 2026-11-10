import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'

import { SourcePresetRow, SourceSentimentRow } from './SourceRows'

export type CollectionPolicyLabels = {
  title: string
  collectionPreset: string
  manualPresetNote: string
  includeInSentiment: string
  plannedNotConfigurable?: string
  /** 收起态头行那枚短标（这组现在不能改）；空/没给就不挂。 */
  stoppedBadge?: string
  presets: Record<string, string>
}

/**
 * 采集策略：频率档 / 是否纳入情绪分析。
 *
 * **这里没有「启用」**：启用状态只有一个归属，就是源那一行末尾的开关。组内再放一颗，
 * 就等于同一个事实存两份副本——组内读页面持有的 profile、行尾读源视图，各写各的，
 * 读者一动就互相打架（2026-11-10 用户实测：动组内那颗，上面整行被关掉）。
 */
export function CollectionPolicySection(props: {
  /** 这一组属于哪个源：按源实例化的设置行要用它派生实例键。 */
  sourceId: string
  draftProfile: IntelligenceSourceProfile
  supportsSentiment: boolean
  configurable?: boolean
  /**
   * Whether this source's enable switch (the one at the end of its row) is usable at all.
   * It only decides which note the group shows; the switch itself lives in the row.
   */
  enabledConfigurable?: boolean
  labels: CollectionPolicyLabels
  resolveText: (key: string) => string
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}): React.ReactElement {
  const configurable = props.configurable ?? true
  const enabledConfigurable = props.enabledConfigurable ?? configurable
  // 产品自有采集的源：预设与情绪开关都不适用，读者要看到「为什么这行是灰的」——那句解释进 ⓘ，
  // 不占正文（正文只允许字段名、当前值、控件）。pending 那句是**状态**，留在正文。
  const productOwned = enabledConfigurable && !configurable
  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      {!enabledConfigurable && props.labels.plannedNotConfigurable ? (
        <p className="intelligence-source-note">{props.labels.plannedNotConfigurable}</p>
      ) : null}
      {/* 两行都从声明来（值/可见性/行键），顺序就是 `SOURCE_ROWS` 的声明顺序：预设在前、情绪在后。 */}
      <div className="intelligence-setting-grid">
        <SourcePresetRow
          configurable={configurable}
          labels={props.labels}
          onChange={props.onChange}
          productOwned={productOwned}
          profile={props.draftProfile}
          resolveText={props.resolveText}
          sourceId={props.sourceId}
        />
        <SourceSentimentRow
          disabled={!configurable}
          onChange={props.onChange}
          profile={props.draftProfile}
          resolveText={props.resolveText}
          sourceId={props.sourceId}
          supportsSentiment={props.supportsSentiment}
        />
      </div>
    </section>
  )
}
