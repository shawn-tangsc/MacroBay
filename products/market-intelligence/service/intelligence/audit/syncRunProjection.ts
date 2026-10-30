import type { JobRunRecord } from '@platform/jobs'

import { getSource } from '../application/providerRegistry'

import {
  SYNC_RUN_LIMITS,
  type SyncAuditEntry,
  type SyncRunAction,
  type SyncRunOutcome,
  type SyncRunQuery,
  type SyncRunRow,
  type SyncRunWindow
} from '../../../contracts/syncRunRecords'
export { syncRunsCsv } from '../../../contracts/syncRunRecords'

type CatalogEntry = Readonly<{
  /** What ran, in the reader's language. */
  taskLabel: string
  action: SyncRunAction
  /** Used only when the run's payload names no source. */
  sourceId?: string
  sourceLabel?: string
}>

/**
 * Handler → task and source.
 *
 * The two are different questions: "AI 分析" is a task with no source, while "官方日历排期" is a task
 * whose source is the Fed calendar. Collapsing them into one column was what made the table read as
 * a list of mystery job ids.
 */
export const syncRunHandlerCatalog: Readonly<Record<string, CatalogEntry>> = {
  'market-intelligence.collectSource': { taskLabel: '情报源采集', action: 'collect' },
  'market-intelligence.refreshMacroCalendar': { taskLabel: '官方日历排期', action: 'collect', sourceId: 'macro-calendar-fed', sourceLabel: '美联储官方日历' },
  'market-intelligence.refreshMacroCalendar.manual.macro-calendar-fed': { taskLabel: '官方日历排期（手动）', action: 'refresh', sourceId: 'macro-calendar-fed', sourceLabel: '美联储官方日历' },
  'market-intelligence.refreshMacroCalendar.manual.macro-calendar-bea': { taskLabel: '官方日历排期（手动）', action: 'refresh', sourceId: 'macro-calendar-bea', sourceLabel: 'BEA 官方发布' },
  'market-intelligence.refreshBeaOfficialReleases': { taskLabel: 'BEA 官方发布值', action: 'collect', sourceId: 'macro-calendar-bea', sourceLabel: 'BEA 官方发布' },
  'market-intelligence.syncBlsScheduleAndValues': { taskLabel: 'BLS 日程与数值', action: 'collect', sourceId: 'macro-calendar-bls', sourceLabel: 'BLS 官方日历' },
  'market-intelligence.refreshMarketCalendar.economic-data': { taskLabel: '市场日历 · 经济数据', action: 'collect', sourceId: 'macro-calendar-0xrouter-economic-data', sourceLabel: '市场日历 · 经济数据' },
  'market-intelligence.refreshMarketCalendar.financial-events': { taskLabel: '市场日历 · 金融事件', action: 'collect', sourceId: 'macro-calendar-0xrouter-financial-events', sourceLabel: '市场日历 · 金融事件' },
  'market-intelligence.refreshMarketCalendar.central-bank-activities': { taskLabel: '市场日历 · 央行活动', action: 'collect', sourceId: 'macro-calendar-0xrouter-central-bank-activities', sourceLabel: '市场日历 · 央行活动' },
  'market-intelligence.collect-macro-market': { taskLabel: '宏观行情', action: 'collect', sourceId: 'realmarketapi-market', sourceLabel: 'RealMarketAPI 宏观行情' },
  'market-intelligence.collect-cross-asset-index': { taskLabel: '纳指指数', action: 'collect', sourceId: 'realmarketapi-market', sourceLabel: 'RealMarketAPI 宏观行情' },
  'market-intelligence.collect-realmarketapi-dxy': { taskLabel: '美元指数', action: 'collect', sourceId: 'realmarketapi-market', sourceLabel: 'RealMarketAPI 宏观行情' },
  'market-intelligence.collect-policy-path': { taskLabel: 'Fed 决议盘口', action: 'collect', sourceId: 'policy-path-market', sourceLabel: 'Fed 决议盘口' },
  'market-intelligence.runMarketAnalysis': { taskLabel: 'AI 分析', action: 'analysis' },
  'market-intelligence.freezeMarketAnalysisSnapshot': { taskLabel: '分析快照', action: 'analysis' },
  'market-intelligence.dailyBriefing': { taskLabel: '每日简报', action: 'analysis' },
  'market-intelligence.translateItems': { taskLabel: '翻译任务', action: 'other' },
  'market-intelligence.scoreNewsSentiment': { taskLabel: '舆情评分', action: 'analysis' },
  'market-intelligence.enrichNewsDocuments': { taskLabel: '舆情正文', action: 'collect' },
  'market-intelligence.normalizeRawRecords': { taskLabel: '原始记录归一', action: 'other' },
  'market-intelligence.assessChangedItems': { taskLabel: '变更判定', action: 'analysis' },
  'market-intelligence.groupMarketAnalysisChange': { taskLabel: '变更分组', action: 'analysis' },
  'market-intelligence.recoverMarketAnalysisRuns': { taskLabel: '分析恢复', action: 'analysis' },
  'market-intelligence.analysisSessionSlots': { taskLabel: '分析盘口', action: 'analysis' },
  'market-intelligence.verifyMarketAnalysisPredictions': { taskLabel: '预测校验', action: 'analysis' },
  'market-intelligence.refreshSentimentAggregates': { taskLabel: '舆情汇总', action: 'analysis' },
  'market-intelligence.retain-market-history': { taskLabel: '历史保留', action: 'other' }
}

const auditActionLabels: Readonly<Record<string, string>> = {
  configure: '配置变更', test: '测试连接', refresh: '手动运行', import: '导入文件', collect: '手动采集'
}

const FAILURE_CODE = /\b([a-z]+(?:-[a-z]+){1,4})\b/

export function projectSyncRun(row: JobRunRecord): SyncRunRow {
  const entry = syncRunHandlerCatalog[row.handlerId]
  const at = row.completedAt ?? row.startedAt ?? row.createdAt
  const detail = row.lastError ? row.lastError.slice(0, SYNC_RUN_LIMITS.detailMaxLength) : undefined
  const durationMs = durationOf(row)
  const failureCode = failureCodeOf(row.lastError)
  return {
    at,
    runId: row.id,
    correlationId: row.id,
    taskLabel: entry?.taskLabel ?? row.handlerId,
    sources: sourcesOf(row, entry),
    handlerId: row.handlerId,
    action: entry?.action ?? 'other',
    outcome: outcomeOf(row.status),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(detail ? { detail } : {})
  }
}

/** A product-side action, dressed as the same row so one table can show both. */
export function projectSyncAudit(entry: SyncAuditEntry): SyncRunRow {
  const described = Object.values(syncRunHandlerCatalog).find((candidate) => candidate.sourceId === entry.target)
  return {
    at: entry.at,
    runId: entry.id,
    correlationId: entry.id,
    taskLabel: auditActionLabels[entry.action] ?? entry.action,
    // The target is always a source or provider id, even when no job describes it yet.
    sources: [{ sourceId: entry.target, label: described?.sourceLabel ?? sourceLabel(entry.target) ?? entry.target }],
    handlerId: entry.action,
    action: entry.action,
    outcome: entry.outcome,
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    ...(entry.failureCode === undefined ? {} : { failureCode: entry.failureCode }),
    ...(entry.detail === undefined ? {} : { detail: entry.detail })
  }
}

/** Newest first, filtered by window, task, source and outcome, then capped. */
export function projectSyncRuns(runs: readonly JobRunRecord[], query: SyncRunQuery, nowMs: number): readonly SyncRunRow[] {
  return runs.map(projectSyncRun)
    .filter((row) => withinWindow(row.at, query.window, nowMs))
    .filter((row) => query.sourceId === undefined || row.sources.some((source) => source.sourceId === query.sourceId))
    .filter((row) => query.outcome === undefined || row.outcome === query.outcome)
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, Math.min(Math.max(query.limit, 1), SYNC_RUN_LIMITS.maximumLimit))
}

/**
 * Source ids are read from the payload, not guessed from the handler: the batch collector runs once
 * per source and the run itself says which one.
 */
function sourcesOf(row: JobRunRecord, entry: CatalogEntry | undefined): SyncRunRow['sources'] {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}
  const ids: string[] = []
  for (const key of ['sourceId', 'providerId', 'source'] as const) {
    const value = payload[key]
    if (typeof value === 'string' && value) ids.push(value)
  }
  const many = payload.sourceIds
  if (Array.isArray(many)) for (const value of many) if (typeof value === 'string' && value) ids.push(value)
  const unique = [...new Set(ids)]
  if (unique.length === 0 && entry?.sourceId) unique.push(entry.sourceId)
  // The catalogue's label is curated for this column; the registry name is the fallback for sources
  // it has never heard of.
  return unique.map((sourceId) => ({ sourceId, label: entry?.sourceLabel ?? sourceLabel(sourceId) ?? sourceId }))
}

function sourceLabel(sourceId: string): string | undefined {
  try {
    return getSource(sourceId)?.displayName
  } catch {
    return undefined
  }
}

function withinWindow(at: string, window: SyncRunWindow, nowMs: number): boolean {
  if (window === 'all') return true
  const parsed = Date.parse(at)
  return Number.isFinite(parsed) && nowMs - parsed <= SYNC_RUN_LIMITS.windowMs[window]
}

function outcomeOf(status: JobRunRecord['status']): SyncRunOutcome {
  if (status === 'completed') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'running'
}

function durationOf(row: JobRunRecord): number | undefined {
  const start = Date.parse(row.startedAt ?? row.createdAt)
  const end = row.completedAt ? Date.parse(row.completedAt) : Number.NaN
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined
}

/** `provider-disabled`, `parser-output-empty`: a hyphenated token is the failure code. */
function failureCodeOf(error: string | undefined): string | undefined {
  return error ? FAILURE_CODE.exec(error)?.[1] : undefined
}
