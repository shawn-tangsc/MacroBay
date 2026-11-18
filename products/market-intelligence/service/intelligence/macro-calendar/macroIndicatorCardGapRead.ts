import type { DatabaseSync } from 'node:sqlite'

import type { MacroIndicatorCardGap } from './macroIndicatorCardFacts'

/**
 * **三张简化卡「为什么没有数」的只读取数**（Chief 2026-11-19，产品 41 号文）。
 *
 * 两种，都在**期次层**，不整码：
 * 1. **待发布**：这一期还没到，标准表里是 `status='scheduled'` 且排期在 `asOf` 之后；
 * 2. **已发布但没有值**：标准行的 `missing_reason` 闭集——
 *    `structural-no-source`（无此数据）/ `source-no-value`（未提供）。
 *
 * 只从标准表取：那里已经有「这一期是什么状态、为什么没值」的事实；再从观测表或名字反推，
 * 就会与日历给出两个说法。读不到返回 `undefined`（= 这一档不存在），不猜。
 */
export function readMacroIndicatorCardGap(
  database: DatabaseSync,
  input: Readonly<{ metricKey: string; asOf: string }>
): MacroIndicatorCardGap | undefined {
  try {
    /**
     * **先看「已发布但没有值」**，再看「待发布」。
     *
     * 顺序不能反：缺值原因属于**正在显示的那一期**；先判未来的排期，会让 CPI 年率那一格
     * 从「无此数据」变成「待发布」——同一格两句话，读者分不清 10 月到底是没来源还是没到。
     * 只看闭集里的两种；其它（还没回填、解析失败的占位）不在这里冒充「无此数据」。
     */
    const missing = database.prepare(`select missing_reason, missing_basis
      from mi_calendar_events
      where metric_key = ? and row_kind = 'release'
        and coalesce(scheduled_at, scheduled_date) < ?
        and missing_reason in ('structural-no-source', 'source-no-value')
      order by coalesce(scheduled_at, scheduled_date) desc limit 1`).get(input.metricKey, input.asOf) as
      { missing_reason: string; missing_basis: string | null } | undefined
    if (missing !== undefined) {
      return Object.freeze({
        missing: Object.freeze({
          reason: missing.missing_reason as 'structural-no-source' | 'source-no-value',
          ...(missing.missing_basis === null ? {} : { basis: missing.missing_basis })
        })
      })
    }
    /**
     * **默认期次 = 最近一期有已发布内容的期次**（用户 2026-11-19，Chief 转达）：
     * 只要过去有一期**有值**（`values_json` 带 actual），卡片就该落在那一期上，
     * 不能因为"未来还有一期没发布"就把整张卡写成「待发布」——PCE 的 1–9 月都有值、
     * 10 月 11-25 才发，卡片必须落在 9 月。
     *
     * 有内容的历史期存在时这里返回 `undefined`：值由读数那条链给，本函数不掺和。
     */
    const publishedWithValue = database.prepare(`select 1 from mi_calendar_events
      where metric_key = ? and row_kind = 'release'
        and coalesce(scheduled_at, scheduled_date) < ?
        and values_json like '%"actual"%'
      limit 1`).get(input.metricKey, input.asOf)
    if (publishedWithValue !== undefined) return undefined
    /**
     * 待发布：**排期在 asOf 之后**的那一行（`scheduled`），取最近一期——
     * 隔两期之后的事不是「这一期还没发布」，写成待发布会让读者以为下一期马上到。
     */
    const pending = database.prepare(`select period_key, coalesce(scheduled_at, scheduled_date) as at
      from mi_calendar_events
      where metric_key = ? and row_kind = 'release' and status = 'scheduled'
        and coalesce(scheduled_at, scheduled_date) >= ?
      order by coalesce(scheduled_at, scheduled_date) asc limit 1`).get(input.metricKey, input.asOf) as
      { period_key: string; at: string } | undefined
    if (pending !== undefined) {
      return Object.freeze({ pending: Object.freeze({ period: pending.period_key, releaseAt: pending.at }) })
    }
    return undefined
  } catch {
    // 读失败不在这里造一个状态：卡上那一格会走「读取失败」，与本函数返回 `undefined` 区分开。
    return undefined
  }
}