import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **写入侧认回「同一件事的另一条名字」**（迁移 18 的另一半）。
 *
 * 只做库内合并还不够：源每次采集都会把中文名、英文名两条**重新发一遍**，只删不堵的话，
 * 下一次采集就把刚合掉的那行插回来——用户明天再看还是两行。
 *
 * 认回的判据与迁移完全一致，**不按名字匹配**：
 * `源 + 国家 + 数组身份第一段 + 期次`。期次用**精确值**：周度指标（钻井数、失业金申请）
 * 同月本来就有多次发布，按月份认回会把四次发布并成一行。
 *
 * 两种名字的分工：`source_label` 存**中文名做显示**，`source_label_en` 存**英文原文**只进搜索命中列。
 * 谁先到都不影响这个分工——英文先到时先占 `source_label`，中文那条到了再挪。
 */

const hasCjk = (value: string | null): boolean => value !== null && /[\u4e00-\u9fff]/.test(value)

/** 数组身份（`["214790",79090]`）才可能中英重复；标准码身份原样返回，不参与。 */
export const isSourceIdentityKey = (metricKey: string): boolean => metricKey.startsWith('[')

export type SameSourceIdentityTarget = Readonly<{
  metricKey: string
  periodKey: string
  firstScheduledDate: string
  sourceLabel: string | null
  sourceLabelEn: string | null
}>

/** 同一来源、同一数组身份、同一期次已经有一行时返回它（含已存的两个名字）。 */
export function resolveSameSourceIdentityTarget(database: DatabaseSync, input: Readonly<{
  countryCode: string
  sourceProviderId: string
  metricKey: string
  periodKey: string
}>): SameSourceIdentityTarget | undefined {
  if (!isSourceIdentityKey(input.metricKey)) return undefined
  const row = database.prepare(`select metric_key, period_key, first_scheduled_date, source_label, source_label_en
    from ${calendarStandardTablePolicy.eventsTable}
    where source_provider_id = ? and country_code = ? and period_key = ?
      and metric_key like '[%' and json_valid(metric_key)
      and json_extract(metric_key, '$[0]') = json_extract(?, '$[0]')
    limit 1`).get(input.sourceProviderId, input.countryCode, input.periodKey, input.metricKey) as
    Record<string, unknown> | undefined
  if (row === undefined) return undefined
  return {
    metricKey: String(row.metric_key),
    periodKey: String(row.period_key),
    firstScheduledDate: String(row.first_scheduled_date),
    sourceLabel: row.source_label === null ? null : String(row.source_label),
    sourceLabelEn: row.source_label_en === null || row.source_label_en === undefined ? null : String(row.source_label_en)
  }
}

/**
 * 这一笔该往两列各写什么：**中文名做显示、英文原文只做搜索**，谁先到都不变。
 * 返回的是「要写的值」，没有的那一列为 `null`（`coalesce` 在 upsert 里保证不拿空值盖掉已有值）。
 */
export function sourceLabelsForWrite(
  target: SameSourceIdentityTarget | undefined,
  incoming: string | undefined
): Readonly<{ sourceLabel: string | null; sourceLabelEn: string | null }> {
  const storedLabel = target?.sourceLabel ?? null
  const storedEn = target?.sourceLabelEn ?? null
  const next = incoming === undefined || incoming.trim() === '' ? null : incoming.trim()
  if (next === null) return { sourceLabel: storedLabel, sourceLabelEn: storedEn }
  // 已经存下的英文名：可能躺在英文列，也可能因为先到而暂时占着显示位。
  const storedEnglish = storedEn ?? (hasCjk(storedLabel) || storedLabel === null ? null : storedLabel)
  if (hasCjk(next)) {
    // 中文名到了：占显示位；原来占着显示位的英文原文挪进英文列。
    return { sourceLabel: next, sourceLabelEn: storedEnglish }
  }
  // 英文名到了：有中文名就只进英文列；**没有中文名时先占显示位**——否则这一行没有任何可显示的名字，
  // 界面会退回显示源内 id。
  return hasCjk(storedLabel)
    ? { sourceLabel: storedLabel, sourceLabelEn: next }
    : { sourceLabel: storedLabel ?? next, sourceLabelEn: storedEn }
}
