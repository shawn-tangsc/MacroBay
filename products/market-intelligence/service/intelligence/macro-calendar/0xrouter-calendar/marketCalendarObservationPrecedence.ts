/**
 * 同一事件多行观测：**哪一行为准**（规则见 `macro-calendar-observation-precedence.md` §3）。
 *
 * 这是读取侧的兜底，不是解法：写入侧应当不再产生矛盾行。但只要库里可能有两行，读取就必须
 * 按固定规则选，而且**不许依赖查询顺序或插入顺序**——今天那条非农就是这样被漏掉的：推送读到
 * 「等待中」那行，日报读到有值那行，两边读的不是同一行。
 *
 * 四条规则，先分出胜负就停：
 *  1. 已发布（有实际值）优先于未发布；
 *  2. 同状态取「可见时刻」更新的（我们什么时候看到的，不是数据说它什么时候发生）；
 *  3. 仍相同取检测时刻更新的；
 *  4. 仍相同按稳定键字典序，只为让重放唯一。
 *
 * **不许跨行拼字段**：胜者是整行，不是「实际值取 A、预期值取 B」。拼出来的是任何来源都
 * 没说过的事实，以后也查不出它是拼的。
 */
export type MarketObservationCandidate = Readonly<{
  /** 事件身份：同一事件同一报告期。 */
  eventIdentity: string
  /** 有实际值就是「已发布」。 */
  hasActual: boolean
  /** 可见时刻：这一行被我们看到的时刻。 */
  visibleAt: string
  /** 稳定键，仅用于最后决胜；不许用查询顺序。 */
  stableKey: string
}>

/** 返回 `true` 表示 `candidate` 比 `incumbent` 更该被采用。 */
export function preferredObservation(
  incumbent: MarketObservationCandidate | undefined,
  candidate: MarketObservationCandidate
): boolean {
  if (incumbent === undefined) return true
  if (candidate.hasActual !== incumbent.hasActual) return candidate.hasActual
  const candidateVisible = Date.parse(candidate.visibleAt)
  const incumbentVisible = Date.parse(incumbent.visibleAt)
  if (candidateVisible !== incumbentVisible) {
    // 时刻读不出来时按「更旧」处理：不能让一条坏时间戳赢过一条正常的。
    if (!Number.isFinite(candidateVisible)) return false
    if (!Number.isFinite(incumbentVisible)) return true
    return candidateVisible > incumbentVisible
  }
  return candidate.stableKey > incumbent.stableKey
}

/** 同一次读取里，同身份出现多行就是一条缺陷；返回出现过的身份，供调用方记一条。 */
export function duplicatedIdentities(seen: Iterable<string>): readonly string[] {
  const counts = new Map<string, number>()
  for (const identity of seen) counts.set(identity, (counts.get(identity) ?? 0) + 1)
  return Object.freeze([...counts].filter(([, count]) => count > 1).map(([identity]) => identity).sort())
}
