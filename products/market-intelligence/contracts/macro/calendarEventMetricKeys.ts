/**
 * **一条事件行的指标键怎么读**——`measureKeys` 的唯一解析入口。
 *
 * 语义在 2026-11-21 变了：
 * - **旧行**：`measureKeys` 是「这一行**覆盖**哪些指标」，长度可以 > 1，但值只有主测度那**一份**；
 * - **新行**（按 measure 拆行之后）：`measureKeys` 是「这一行**是**哪个指标」，**恰好 1 个码**。
 *
 * 所以「长度 > 1」就是 **legacy 行**的唯一判据。legacy 行只有**主测度**那个码可以读值，
 * 其余码一律「未提供」——不拿主测度的数去顶兄弟指标，这正是这次要根治的串值。
 *
 * 为什么只许有这一个函数：三个调用点（`useExpectationSeries` 取名、`nextReleaseOf` 取日期、
 * `policyPath` 判资格）各自写一遍判断，第四个人就会写成 `keys[0]`，串值从下一个读值的地方回来。
 *
 * 现状备注（2026-11-21 核查）：这三个调用点**今天都不读值**（只用键列表取名字/日期/资格），
 * 按指标取值的卡片路径 `resolveMacroIndicatorFact` 也已自带两道护栏。这个函数是为**将来**任何
 * 「把行上的值算到某个码头上」的读法准备的，不是修今天的 bug。
 */
export type CalendarEventMetricKeys = Readonly<{
  /** 这一行覆盖/代表的全部指标码：读名字、读日期、判资格用它。 */
  keys: readonly string[]
  /** `keys.length > 1`＝旧行（一行多指标名，值只有主测度那份）。 */
  legacy: boolean
  /** 这一行的**值**能算到哪些码头上——取值的唯一入口；legacy 行最多一个。 */
  readableKeys: readonly string[]
}>

/**
 * @param row `measureKeys` 必给；`primaryMetricKey` 是「这一行的值属于哪个码」——
 *   旧源行来自写入时的身份（`eventNameKey` / 台账四元组），新行就是它自己那唯一一个码。
 *   解不出主测度时**不给任何码读数**（宁可不显示，也不许串值）。
 */
export function readEventMetricKeys(row: Readonly<{
  measureKeys?: readonly string[]
  primaryMetricKey?: string
}>): CalendarEventMetricKeys {
  const keys = Object.freeze([...(row.measureKeys ?? [])])
  const legacy = keys.length > 1
  if (!legacy) return { keys, legacy, readableKeys: keys }
  const primary = row.primaryMetricKey
  const readable = primary === undefined || !keys.includes(primary) ? [] : [primary]
  return { keys, legacy, readableKeys: Object.freeze(readable) }
}