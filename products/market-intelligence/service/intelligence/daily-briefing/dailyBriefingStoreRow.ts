import { DEFAULT_PERIOD_ID, type DailyBriefingDocument, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingPolicy, isDailyBriefingDocumentWithinBudget } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStoredEdition } from './dailyBriefingService'
import { DAILY_BRIEFING_STORAGE_VERSION } from './dailyBriefingStorageMigration'

/**
 * 存储行怎么读出来、读不出来怎么留证据——与建表、写语句分开（文件越过 500 行软上限时抽出的）。
 *
 * 这里只做「一行 → 一个已发布版次」的纯转换：不建语句、不碰事务、不写库。`parseRow` 的失败
 * 路径是这一层唯一的行为：**每一种读不出来都留一条可检索的 warn，同一条身份只报一次**。
 */

export type Row = Readonly<{
  edition_date: string
  period_id?: string
  locale: string
  generated_at: string
  window_start: string
  window_end: string
  document_json: string
  schema_version: number
  trace_json?: string | null
}>

/**
 * 一行读不出来时，**必须留下能读的证据**（用户 2026-11-14：所有版本一起变成「读取失败」，
 * 而三处 `return undefined` 一声不吭）。同一条身份只报一次，避免每 1.5 秒刷屏。
 */
const readFailuresReported = new Set<string>()
function reportUnreadableRow(row: Row, reason: string, detail: Readonly<Record<string, unknown>> = {}): void {
  const key = `${row.edition_date}|${row.period_id ?? DEFAULT_PERIOD_ID}|${row.locale}|${reason}`
  if (readFailuresReported.has(key)) return
  readFailuresReported.add(key)
  console.warn(`[daily-briefing] stored edition cannot be read ${JSON.stringify({
    reason,
    date: row.edition_date,
    periodId: row.period_id ?? DEFAULT_PERIOD_ID,
    locale: row.locale,
    storageSchemaVersion: row.schema_version,
    bytes: row.document_json.length,
    ...detail
  })}`)
}

/** 把文档里的期次号覆盖成表列那个值（相同则原样返回，避免无谓复制）。 */
function normalizedDocument(document: DailyBriefingDocument, periodId: string): DailyBriefingDocument {
  if (document.edition.periodId === periodId) return document
  return Object.freeze({ ...document, edition: Object.freeze({ ...document.edition, periodId }) })
}

export function parseRow(row: Row | undefined): DailyBriefingStoredEdition | undefined {
  if (!row) return undefined
  // A row written before the upgrade carries the old storage version; its document shape is the
  // same, so the version only tells us which table it came from.
  // **存储版本不是文档版本**：bump 之后必须继续读得动上一版写的行（2..当前版本），否则升级那一刻
  // 上一版写的历史会整批消失（2026-11-09 事故：3→4 把 10/30–11/02 与今天的中文版一起藏了起来）。
  // 只拒绝未来版本——这个 build 读不懂还不存在的形状。
  if (row.schema_version < 2 || row.schema_version > DAILY_BRIEFING_STORAGE_VERSION) {
    reportUnreadableRow(row, 'storage-version', { supported: DAILY_BRIEFING_STORAGE_VERSION })
    return undefined
  }
  let document: DailyBriefingDocument
  try {
    document = JSON.parse(row.document_json) as DailyBriefingDocument
  } catch (error) {
    reportUnreadableRow(row, 'json-parse', { error: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120) })
    return undefined
  }
  if (!isDailyBriefingDocumentWithinBudget(document)) {
    reportUnreadableRow(row, 'over-budget', {
      // 上限与文档自己的版本都打出来：版本新一档、形状多了字段时，最容易在这里被静默拒掉。
      maximumBytes: dailyBriefingPolicy.maximumBytes,
      documentSchemaVersion: (document as { schemaVersion?: number }).schemaVersion ?? null,
      policySchemaVersion: dailyBriefingPolicy.schemaVersion
    })
    return undefined
  }
  // **期次身份以表列为准**（用户 2026-11-14）：库里有两份身份（表列、文档 `edition.periodId`），
  // 今晚「点开是空的」全部源于这两份对不上——列表展示文档里那个，详情按表列去查。
  // 读出来的那一刻就归一，下游（列表投影、点开、导出、分享卡）自动一致，不用到处改判据。
  // 文档里那个字段降级为**展示信息**，不再当身份用。
  const periodId = row.period_id ?? DEFAULT_PERIOD_ID
  return Object.freeze({
    date: row.edition_date,
    periodId,
    locale: row.locale as DailyBriefingLocale,
    generatedAt: row.generated_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    // 期次身份以表列为准：文档里那个字段降级为展示信息（见上方注释）。
    document: normalizedDocument(document, periodId)
  })
}
