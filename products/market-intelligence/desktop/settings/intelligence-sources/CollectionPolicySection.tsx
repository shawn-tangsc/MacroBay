import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'

import { SourceSentimentRow } from './SourceRows'

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
/**
 * 「这个源怎么采」剩下的那一行：**只有「纳入情绪分析」**。
 *
 * 采集预设已按用户 2026-11-12 挪到「采集与数据」每个源项下面（一处写、一处读）；
 * 这里不再渲染它，注册表里的声明仍保留（那是数据，不是第二个入口）。
 * 移走后本块唯一的一行是条件行（`supportsSentiment`）：不支持情绪的源**整块不渲染**，
 * 不留空标题或空网格。
 */
export function CollectionPolicySection(props: {
  /** 这一组属于哪个源：按源实例化的设置行要用它派生实例键。 */
  sourceId: string
  draftProfile: IntelligenceSourceProfile
  supportsSentiment: boolean
  configurable?: boolean
  /**
   * Whether this source's enable switch (the one at the end of its row) is usable at all.
   * Kept for the sentiment row's disabled state; the switch itself lives in the row.
   */
  enabledConfigurable?: boolean
  labels: CollectionPolicyLabels
  resolveText: (key: string) => string
  /** 保留入参形状：这一块已经不再有「采集预设」那行可挂说明。 */
  notConfigurable?: CollectionPolicyNotConfigurable
  /** 外层区块已经画了标题时传 false：同一屏里「采集策略」只出现一次。 */
  showTitle?: boolean
  onChange: (patch: Partial<IntelligenceSourceProfile>) => void
}): React.ReactElement | null {
  const configurable = props.configurable ?? true
  if (!props.supportsSentiment) return null
  return (
    <div className="intelligence-policy-rows">
      {props.showTitle === false ? null : <div className="intelligence-section-title">{props.labels.title}</div>}
      <div className="intelligence-setting-grid">
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
