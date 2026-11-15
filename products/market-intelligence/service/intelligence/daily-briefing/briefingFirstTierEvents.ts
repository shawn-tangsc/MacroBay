import type { BriefingNextItem } from '../../../contracts/dailyBriefing'

/**
 * 一级宏观事件：**按身份认，不按 `importance`**（用户/Chief 2026-11-16）。
 *
 * 为什么不能按重要性：标准表里 narwhal 那批行的重要性是空的（源没给，我们也不许补），
 * 而 0xrouter 那批带 `high`。如果「接下来」继续按 `importance === 'high'` 取候选，一级事件里
 * 只有聚合站那一条能进来——放开之后又会变成两条同名事件并排。所以必须另有一条身份判据：
 *
 * `FOMC 决议/纪要`、`CPI`（含核心）、`非农`（含失业率，同一份就业报告）这三族，只要在窗口内，
 * 就往「接下来」的候选里放；交给后面的排序与选材决定位置，但**不许因为重要性为空而消失**。
 *
 * 识别顺序：先看标准行的指标码（`metricKey`，最可靠），再退到事件键与已登记的 `titleKey`，
 * 最后才是源给的原文标题（0xrouter 的数组形 key 没有指标码，只能靠原文名认）。
 */
export type BriefingFirstTierFamily = 'fomc' | 'inflation' | 'labor'

export type BriefingFirstTierIdentity = Readonly<{
  eventKey?: string
  title?: string
  titleKey?: string
  metricKey?: string
}>

const fomc = {
  metric: /^(?:US\.FOMC(?:\.|$)|evt\.(?:monetary-policy|fomc))/, event: /^US\.FOMC(?:\.|$)/, titleKey: /^fomc$/, title: /FOMC|货币政策会议纪要|美联储.{0,6}会议纪要/i
}
const inflation = {
  metric: /^US\.(?:CORE_)?CPI(?:\.|$)/, event: /^US\.(?:CORE\.)?CPI/, titleKey: /^(?:core-)?cpi$/, title: /(?:^|[^A-Za-z])CPI(?:[^A-Za-z]|$)|消费者物价指数/
}
const labor = {
  metric: /^US\.(?:NONFARM_PAYROLLS|UNEMPLOYMENT)(?:\.|$)/, event: /^US\.(?:NONFARM|UNEMPLOYMENT)/,
  titleKey: /^(?:nonfarm-payrolls|unemployment)$/, title: /非农|新增就业|失业率|NFP|nonfarm/i
}

export function briefingFirstTierFamily(identity: BriefingFirstTierIdentity): BriefingFirstTierFamily | undefined {
  const metricKey = identity.metricKey
  const eventKey = identity.eventKey ?? ''
  const titleKey = identity.titleKey ?? ''
  const title = identity.title ?? ''
  if ((metricKey !== undefined && fomc.metric.test(metricKey)) || fomc.event.test(eventKey) || fomc.titleKey.test(titleKey) || fomc.title.test(title)) return 'fomc'
  if ((metricKey !== undefined && inflation.metric.test(metricKey)) || inflation.event.test(eventKey) || inflation.titleKey.test(titleKey) || inflation.title.test(title)) return 'inflation'
  if ((metricKey !== undefined && labor.metric.test(metricKey)) || labor.event.test(eventKey) || labor.titleKey.test(titleKey) || labor.title.test(title)) return 'labor'
  return undefined
}

/**
 * 把「必须出现的一级事件」并进已选条目：一级事件在前，其余按原顺序，去重后截到上限。
 * 已选里本来就有它的不重复；focus 那条不算在 items 里（由版面置顶显示）。
 */
export function mergeFirstTierNext<T extends Pick<BriefingNextItem, 'eventKey'>>(input: Readonly<{
  focusEventKey?: string
  selected: readonly T[]
  mustKeep: readonly T[]
  limit: number
}>): readonly T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const item of [...input.mustKeep, ...input.selected]) {
    if (item.eventKey === input.focusEventKey || seen.has(item.eventKey)) continue
    seen.add(item.eventKey)
    merged.push(item)
  }
  return Object.freeze(merged.slice(0, input.limit))
}
