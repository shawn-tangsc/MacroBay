import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'

import { SourcePresetRow, SourceSentimentRow } from './SourceRows'

export type CollectionPolicyLabels = {
  title: string
  collectionPreset: string
  manualPresetNote: string
  includeInSentiment: string
  /** 收起态头行那枚短标（这组现在不能改）；空/没给就不挂。 */
  stoppedBadge?: string
  presets: Record<string, string>
}

/**
 * 「这一行为什么现在不能改」的说明句：**只走 ⓘ**，正文没有它的位置（用户 2026-11-10：
 * 声明性文字不要直接显示在界面上）。`labelKey` 由调用方给——同一个位置在两种情况下说两句不同的话：
 * 源取不到（同步已停止）与源还没接入（尚未实现）。
 */
export type CollectionPolicyNotConfigurable = Readonly<{ ariaLabelKey: string; labelKey: string }>

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
  /**
   * 这一行不能改的原因（键 + 读屏名）。给了就挂到「采集预设」字段名旁的 ⓘ 里，
   * **正文不留整句**：整行说明这种位置已经没有了。
   */
  notConfigurable?: CollectionPolicyNotConfigurable
  /** 外层区块已经画了标题时传 false：同一屏里「采集策略」只出现一次。 */
  showTitle?: boolean
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}): React.ReactElement {
  const configurable = props.configurable ?? true
  const enabledConfigurable = props.enabledConfigurable ?? configurable
  // 产品自有采集的源：预设与情绪开关都不适用，读者要看到「为什么这行是灰的」——那句解释进 ⓘ，
  // 不占正文（正文只允许字段名、当前值、控件）。
  const productOwned = enabledConfigurable && !configurable
  return (
    <div className="intelligence-policy-rows">
      {props.showTitle === false ? null : <div className="intelligence-section-title">{props.labels.title}</div>}
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
          {...(props.notConfigurable === undefined ? {} : { notConfigurable: props.notConfigurable })}
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
    </div>
  )
}
