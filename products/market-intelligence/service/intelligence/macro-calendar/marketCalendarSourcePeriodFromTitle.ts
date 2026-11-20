import { DatabaseSync } from 'node:sqlite'

/**
 * **期次从源标题里解**（用户 2026-11-17 定，方案 A）。
 *
 * 0xrouter 的载荷里没有统计期字段，期次只隐含在标题后缀：`Changes in consumer credit
 * (billions of dollars)(Sep)`、`GDP(QoQ)(Preliminary)(Q2)`。我们此前**拿发布时刻当期次**
 * （`2026-11-16T13:30`），那不是期次——`(Sep)` 那条真期次是 2026-09。这个错会顺着
 * 「按发布日期配对」一路传染成「跨月/同期」的假判断。
 *
 * 规则（**解不出就返回 null，绝不用发布时刻顶**）：
 * - 末尾的 `(Sep)` / `(September)` → 当年该月（年份取发布日的年；跨年回退：发布月 < 统计月时用上一年）；
 * - 末尾的 `(Q2)` → 该季度；
 * - `(Final)` / `(Preliminary)` / `(MoM)` / `(YoY)` / `(billions of dollars)` 这类**不是期次**，跳过；
 * - 标题里没有期次后缀 → `null`（明确缺失）。
 */
export type SourcePeriod = Readonly<{
  periodKey: string
  /** 期次是从哪来的：标题月份 / 标题季度。缺就是缺，不留一个「大概」。 */
  from: 'title-month' | 'title-quarter'
}>

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12
})

const groupsOf = (title: string): string[] =>
  [...title.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]!.trim().toLowerCase())

export function periodFromSourceTitle(title: string, publishedDate: string): SourcePeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) return null
  const publishedYear = Number(publishedDate.slice(0, 4))
  const publishedMonth = Number(publishedDate.slice(5, 7))
  // **中文标题也要能解**（`11月纽约联储制造业指数`、`第三季度…`）：同一事件有 en/zh 两行，
  // 若只有英文能解，谁写入 `period_key` 就决定结果——那是拿 locale 决定事实。
  const zhMonth = /(\d{1,2})月/.exec(title)
  if (zhMonth !== null) {
    const month = Number(zhMonth[1])
    if (month >= 1 && month <= 12) {
      const year = month > publishedMonth ? publishedYear - 1 : publishedYear
      return { periodKey: `${year}-${String(month).padStart(2, '0')}`, from: 'title-month' }
    }
  }
  const zhQuarter = /第?([一二三四1-4])季度/.exec(title)
  if (zhQuarter !== null) {
    const map: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4' }
    const quarter = map[zhQuarter[1]!] ?? zhQuarter[1]!
    return { periodKey: `${publishedYear}-Q${quarter}`, from: 'title-quarter' }
  }
  const groups = groupsOf(title)
  // 从后往前找：期次一般挂在最后，但 `(Sep)(Final)` 这种也在。
  for (const group of [...groups].reverse()) {
    const quarter = /^q([1-4])$/.exec(group)
    if (quarter !== null) return { periodKey: `${publishedYear}-Q${quarter[1]}`, from: 'title-quarter' }
    const month = MONTHS[group]
    if (month === undefined) continue
    // 跨年：发布月早于统计月，说明统计月属于上一年（12 月的数据 1 月发布）。
    const year = month > publishedMonth ? publishedYear - 1 : publishedYear
    return { periodKey: `${year}-${String(month).padStart(2, '0')}`, from: 'title-month' }
  }
  return null
}

export type SourcePeriodReport = Readonly<{
  scanned: number
  resolved: number
  missing: number
  /** 解出来的期次与库里现在的 `period_key` 不一致的行数——就是「我们以前用的是发布时刻」的证据。 */
  differsFromStored: number
  samples: readonly { metricKey: string; stored: string; derived: string | null; from: string }[]
}>

/** 只读体检：不解期次以外的事，也不改库。 */
export function auditSourcePeriods(database: DatabaseSync, limit = 5): SourcePeriodReport {
  const rows = database.prepare(`select metric_key, period_key, scheduled_date, source_label, source_label_en
    from mi_calendar_events where metric_key like '[%'`).all() as unknown as Record<string, unknown>[]
  let resolved = 0, missing = 0, differsFromStored = 0
  const samples: { metricKey: string; stored: string; derived: string | null; from: string }[] = []
  for (const row of rows) {
    const title = String(row.source_label_en ?? row.source_label ?? '')
    const derived = periodFromSourceTitle(title, String(row.scheduled_date))
    if (derived === null) { missing += 1 } else {
      resolved += 1
      if (derived.periodKey !== String(row.period_key)) differsFromStored += 1
    }
    if (samples.length < limit && derived !== null) {
      samples.push({ metricKey: String(row.metric_key), stored: String(row.period_key),
        derived: derived.periodKey, from: derived.from })
    }
  }
  return { scanned: rows.length, resolved, missing, differsFromStored, samples }
}
