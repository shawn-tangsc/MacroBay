/**
 * 日历事件进分析上下文的准入。
 *
 * 为什么要有这一层：一个月的日历有上百个身份，全塞进上下文会把资金、情绪、持仓几个域挤掉——
 * 那不是「日历更全了」，是别的域被挤没了。准入按**发布组**限流，不按来源：同一个发布展开成
 * 十几个指标（就业那组 12 个）不能吃掉一半配额，而「官方优先 / 市场优先」这种判断这里一个
 * 都不做——配额是给不同领域留空间的问题，不是哪边更权威的问题。
 *
 * 两个附加规则：
 * 1. **组内排序**：`isPrimary` 优先（19 号表的主测度），其次有无值，再按贴近度与身份串。
 *    `isPrimary` 未提供时组内上限应传 1——排序分不出主次时，凑够两条更容易挑到冷门测度。
 * 2. **估算单独占位**：`isEstimate` 的行按身份取最新一条，不参与发布配额，也不被发布挤出。
 *    同一个估算逐行进入事实，就是「同一事实多份证据」的另一种写法。
 */

export type MacroCalendarAdmissionRow = Readonly<{
  /** 稳定身份串（国家|指标码|期间|首见日期），跨采集不变。 */
  identity: string
  /**
   * 发布组；同一次发布展开出的所有指标共用它。
   *
   * 空串表示「不知道属于哪个组」：那时按身份各自成组，宁可多进几条，也不要把所有未知组
   * 当成同一个组——那会一次只放一条进来，而且看起来像「日历少了」。
   */
  releaseGroup: string
  importance: 'high' | 'medium' | 'low'
  hasValue: boolean
  /** 距 asOf 的绝对毫秒数；无法解析时用 Number.MAX_SAFE_INTEGER。 */
  distanceMs: number
  /** 是否这批里的主测度（19 号表 `is_primary`）；未知时缺省。 */
  isPrimary?: boolean
  /** 估算行（如 GDP 即时预测）：不进发布配额。 */
  isEstimate: boolean
  /** 同一估算身份有多行时，取这一列最新的那条。 */
  observedAtMs: number
}>

export type MacroCalendarAdmissionPolicy = Readonly<{
  /** 发布行进入上下文的总条数上限。 */
  maximumRows: number
  /** 同一发布组最多进几条；`isPrimary` 未提供时应传 1。 */
  maximumPerGroup: number
}>

export type MacroCalendarAdmissionResult = Readonly<{
  /** 被准入的行，按身份返回，顺序即进入顺序。 */
  admitted: readonly MacroCalendarAdmissionRow[]
  /** 因总额度被挡下的条数（不含组内限流挡下的）。 */
  droppedByTotal: number
  /** 因组内限流被挡下的条数。 */
  droppedByGroup: number
}>

const importanceRank: Readonly<Record<MacroCalendarAdmissionRow['importance'], number>> = Object.freeze({
  high: 0, medium: 1, low: 2
})

function compareRows(left: MacroCalendarAdmissionRow, right: MacroCalendarAdmissionRow): number {
  return (left.isPrimary === right.isPrimary ? 0 : left.isPrimary ? -1 : 1)
    || importanceRank[left.importance] - importanceRank[right.importance]
    || (left.hasValue === right.hasValue ? 0 : left.hasValue ? -1 : 1)
    || left.distanceMs - right.distanceMs
    || left.identity.localeCompare(right.identity)
}

/** 同一估算身份只留最新一条；不是估算的行原样保留。 */
export function latestPerEstimateIdentity(
  rows: readonly MacroCalendarAdmissionRow[]
): readonly MacroCalendarAdmissionRow[] {
  const latest = new Map<string, MacroCalendarAdmissionRow>()
  const kept: MacroCalendarAdmissionRow[] = []
  for (const row of rows) {
    if (!row.isEstimate) { kept.push(row); continue }
    const previous = latest.get(row.identity)
    if (!previous || row.observedAtMs > previous.observedAtMs) latest.set(row.identity, row)
  }
  return [...kept, ...latest.values()]
}

/**
 * 选出这一批进上下文的日历身份。
 *
 * 顺序即优先级：先按组内排序取该组前 `maximumPerGroup` 条，再按同一排序跨组取到总额度；
 * 估算行不占用这两档额度。
 */
export function selectMacroCalendarAdmissions(
  rows: readonly MacroCalendarAdmissionRow[],
  policy: MacroCalendarAdmissionPolicy
): MacroCalendarAdmissionResult {
  const deduped = latestPerEstimateIdentity(rows)
  const releases = deduped.filter(row => !row.isEstimate).sort(compareRows)
  const estimates = deduped.filter(row => row.isEstimate)
  const perGroup = new Map<string, number>()
  const admitted: MacroCalendarAdmissionRow[] = []
  let droppedByGroup = 0
  let droppedByTotal = 0
  for (const row of releases) {
    const group = row.releaseGroup === '' ? `identity:${row.identity}` : row.releaseGroup
    const used = perGroup.get(group) ?? 0
    if (used >= policy.maximumPerGroup) { droppedByGroup += 1; continue }
    if (admitted.length >= policy.maximumRows) { droppedByTotal += 1; continue }
    perGroup.set(group, used + 1)
    admitted.push(row)
  }
  return Object.freeze({
    admitted: Object.freeze([...admitted, ...estimates]),
    droppedByTotal,
    droppedByGroup
  })
}
