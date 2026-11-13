import type { NarwhalStandardRowInput } from './narwhal-calendar/narwhalCalendarObservationBatches'

/**
 * 两层守恒式的**唯一实现**：输入 = 落表 + 未映射 + 显式排除。
 *
 * 为什么要单独抽出来：这套算式写过三版——第一版从**产物**反推被减数（恒等、永远平），
 * 第二版把事件行当 measure（每批恒报假红），第三版才对。因此它必须有能反向跑红的用例，
 * 不能只活在 `bootstrap` 的一个闭包里（那里没有用例能碰到它）。
 *
 * 三条口径，各自对应一次实测：
 * 1. **被减数取源**（`sourceTotals`，来自解析结果）：构造阶段被吞掉的一条既不在 `rows`、
 *    也不在 `unmapped`，从产物反推的话输入会跟着少，方程永远平。
 * 2. **发布层按 id 取并集**：一条发布可能「2 个 measure 落表、1 个未映射」，两边各认领一次
 *    就会算出 −1（不是丢数据，是重复认领）。
 * 3. **测度层只数指标行**：事件型发布没有 measure 身份（实测那 84 条 `values` 为空，其中
 *    1 条带值——值随事件行走，变不成指标行）。所以「随事件行走的 measure」是**显式排除项**，
 *    不是差异；把它算进被减数会每批恒报 +1。
 */
export type CalendarStandardSourceTotals = Readonly<{
  releases: number
  measures: number
  /** 无期间（事件型）发布里的 measure 数：随事件行走，永远变不成指标行。 */
  measuresOnEventReleases: number
}>

export type CalendarStandardConservation = Readonly<{
  releaseDiff: number
  measureDiff: number
  /** 落表 ∪ 未映射，按 `sourceEventId` 去重后的发布数。 */
  creditedReleases: number
  landedMeasures: number
  unmappedMeasures: number
  excludedMeasures: number
}>

export function calendarStandardConservation(input: Readonly<{
  sourceTotals: CalendarStandardSourceTotals
  rows: readonly NarwhalStandardRowInput[]
  unmapped: readonly Readonly<{ sourceKey: string; measureKeys?: readonly string[] }>[]
  failed: number
}>): CalendarStandardConservation {
  const credited = new Set<string>([
    ...input.rows.map((row) => row.sourceEventId),
    ...input.unmapped.map((item) => item.sourceKey)
  ])
  const landedMeasures = input.rows.filter((row) => row.kind === 'indicator').length
  // 未映射条目**只按它列出的 measure 计数**：事件型与 `no-values` 那条本来就有 0 个 measure。
  const unmappedMeasures = input.unmapped.reduce((sum, item) => sum + (item.measureKeys?.length ?? 0), 0)
  const excludedMeasures = input.sourceTotals.measuresOnEventReleases
  return {
    releaseDiff: input.sourceTotals.releases - (credited.size + input.failed),
    measureDiff: input.sourceTotals.measures - (landedMeasures + unmappedMeasures + excludedMeasures),
    creditedReleases: credited.size,
    landedMeasures,
    unmappedMeasures,
    excludedMeasures
  }
}
