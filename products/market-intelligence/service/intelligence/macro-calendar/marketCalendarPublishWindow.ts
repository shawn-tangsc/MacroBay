import type { DatabaseSync } from 'node:sqlite'

/**
 * **发布窗口**（PRD R38 §3.1 v4，产品 2026-11-21 点名）。
 *
 * 当月型序列（CB 消费者信心、芝加哥 PMI、S&P Global 闪值）在发布月里发的是**当月值**，但它们的
 * **终值/修正常常落到下月初**（S&P Global 的 final 多在次月第一个工作日前后）。整条序列只写
 * 「当月」，12-01 发布的 11 月终值就会落成 `2026-12`——与「落成上一月」正好相反的同一个错。
 *
 * 所以每条序列声明两样：**参考期规则 + 发布窗口**。窗口**从该序列历史发布日取统计区间**，
 * 不手写（写死的窗口在排期一挪之后就变成假话）。
 *
 * 判定（`classifyReleaseDay`）：
 * - 窗口内 → 按声明规则定参考期；
 * - 越窗、且落在**发布月头 7 天**内 → 判为上一期值的延迟/终值发布，参考期回退一期；
 * - 其它越窗 → `unknown` + 待核，**不许默认按当月**。
 */
export type PublishWindow = Readonly<{ startDay: number; endDay: number; samples: number }>

/**
 * 历史发布日 → 窗口。取 **20%..80% 分位**而不是 min..max：终值那天本身就在窗口外，
 * 用极值会让窗口把「终值日」也包进来，越窗判定当场失效。样本不足 3 个时退回 min..max
 * （此时也只用来判「头 7 天」，不据此下结论）。
 */
export function derivePublishWindow(releaseDates: readonly string[]): PublishWindow | undefined {
  const days = releaseDates
    .map((date) => Number(date.slice(8, 10)))
    .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31)
    .sort((left, right) => left - right)
  if (days.length === 0) return undefined
  if (days.length < 3) return { startDay: days[0]!, endDay: days[days.length - 1]!, samples: days.length }
  const at = (q: number): number => days[Math.round((days.length - 1) * q)]!
  return { startDay: at(0.2), endDay: at(0.8), samples: days.length }
}

export type WindowVerdict = 'in-window' | 'late-previous' | 'out-of-window'

/** 越窗判定：见文件头三条。`late-previous` 只在「发布月头 7 天」成立。 */
export function classifyReleaseDay(releaseDate: string, window: PublishWindow): WindowVerdict {
  const day = Number(releaseDate.slice(8, 10))
  if (!Number.isFinite(day) || day < 1 || day > 31) return 'out-of-window'
  if (day >= window.startDay && day <= window.endDay) return 'in-window'
  return day <= 7 ? 'late-previous' : 'out-of-window'
}

/** 每个指标 id 的窗口：从观测表的历史发布日现算，不落库、不手写。
 *
 * **不按来源名筛**：`indicator_id` 是源自己的稳定指标 id，观测表里只有旧源那张表会写它
 * （新源的身份在 `market_fact_key` 里），所以按「有 indicator_id」取就够——日历对来源保持不感知，
 * 这里出现来源名会被源名守卫算作新增分支。
 */
export function derivePublishWindows(database: DatabaseSync): ReadonlyMap<string, PublishWindow> {
  const windows = new Map<string, PublishWindow>()
  const table = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get()
  if (table === undefined) return windows
  const rows = database.prepare(`select indicator_id, scheduled_date
    from mi_macro_calendar_market_event_observations
    where indicator_id is not null and trim(indicator_id) <> ''
      and scheduled_date is not null`).all() as unknown as { indicator_id: string; scheduled_date: string }[]
  const byId = new Map<string, string[]>()
  for (const row of rows) {
    const dates = byId.get(row.indicator_id)
    if (dates === undefined) byId.set(row.indicator_id, [row.scheduled_date])
    else dates.push(row.scheduled_date)
  }
  for (const [indicatorId, dates] of byId) {
    const window = derivePublishWindow(dates)
    if (window !== undefined) windows.set(indicatorId, window)
  }
  return windows
}