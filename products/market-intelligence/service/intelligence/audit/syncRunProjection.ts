import type { JobRunRecord } from '@platform/jobs'

import {
  SYNC_RUN_LIMITS,
  type SyncRunAction,
  type SyncRunOutcome,
  type SyncRunQuery,
  type SyncRunRow,
  type SyncRunWindow
} from '../../../contracts/syncRunRecords'

/**
 * Handler → the source it works on.
 *
 * This is data, not logic: a new job shows up under `other` with its raw handler id until a row is
 * added here, so nobody has to remember to make it visible.
 */
export const syncRunHandlerCatalog: Readonly<Record<string, Readonly<{ sourceId?: string; sourceLabel: string; action: SyncRunAction }>>> = {
  'market-intelligence.collectSource': { sourceLabel: '情报源采集', action: 'collect' },
  'market-intelligence.refreshMacroCalendar': { sourceId: 'macro-calendar-fed', sourceLabel: '官方日历排期', action: 'collect' },
  'market-intelligence.refreshMacroCalendar.manual.macro-calendar-fed': { sourceId: 'macro-calendar-fed', sourceLabel: '官方日历排期（手动）', action: 'refresh' },
  'market-intelligence.refreshMacroCalendar.manual.macro-calendar-bea': { sourceId: 'macro-calendar-bea', sourceLabel: '官方日历排期（手动）', action: 'refresh' },
  'market-intelligence.refreshBeaOfficialReleases': { sourceId: 'macro-calendar-bea', sourceLabel: 'BEA 官方发布值', action: 'collect' },
  'market-intelligence.collect-macro-market': { sourceId: 'realmarketapi-market', sourceLabel: '宏观行情', action: 'collect' },
  'market-intelligence.collect-cross-asset-index': { sourceLabel: '纳指指数', action: 'collect' },
  'market-intelligence.collect-realmarketapi-dxy': { sourceLabel: '美元指数', action: 'collect' },
  'market-intelligence.collect-policy-path': { sourceId: 'policy-path-market', sourceLabel: 'Fed 决议盘口', action: 'collect' },
  'market-intelligence.runMarketAnalysis': { sourceLabel: 'AI 分析', action: 'analysis' },
  'market-intelligence.freezeMarketAnalysisSnapshot': { sourceLabel: '分析快照', action: 'analysis' },
  'market-intelligence.dailyBriefing': { sourceLabel: '每日简报', action: 'analysis' }
}

const FAILURE_CODE = /\b([a-z]+(?:-[a-z]+){1,4})\b/

export function projectSyncRun(row: JobRunRecord): SyncRunRow {
  const entry = syncRunHandlerCatalog[row.handlerId]
  const at = row.completedAt ?? row.startedAt ?? row.createdAt
  const detail = row.lastError ? row.lastError.slice(0, SYNC_RUN_LIMITS.detailMaxLength) : undefined
  return {
    at,
    runId: row.id,
    ...(entry?.sourceId ? { sourceId: entry.sourceId } : {}),
    sourceLabel: entry?.sourceLabel ?? row.handlerId,
    handlerId: row.handlerId,
    action: entry?.action ?? 'other',
    outcome: outcomeOf(row.status),
    ...(durationOf(row) === undefined ? {} : { durationMs: durationOf(row) }),
    ...(failureCodeOf(row.lastError) === undefined ? {} : { failureCode: failureCodeOf(row.lastError) }),
    ...(detail ? { detail } : {})
  }
}

/** Newest first, filtered by window/source/outcome and capped. */
export function projectSyncRuns(runs: readonly JobRunRecord[], query: SyncRunQuery, nowMs: number): readonly SyncRunRow[] {
  const rows = runs.map(projectSyncRun).filter((row) => withinWindow(row.at, query.window, nowMs))
    .filter((row) => query.sourceId === undefined || row.sourceId === query.sourceId)
    .filter((row) => query.outcome === undefined || row.outcome === query.outcome)
  return rows
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, Math.min(Math.max(query.limit, 1), SYNC_RUN_LIMITS.maximumLimit))
}

/** The CSV the reader can hand to someone else; the same columns the page shows. */
export function syncRunsCsv(rows: readonly SyncRunRow[], header: readonly string[]): string {
  const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  return [header.map(escape).join(','), ...rows.map((row) => [
    row.at, row.sourceLabel, row.action, row.outcome,
    row.durationMs === undefined ? '' : String(row.durationMs),
    row.failureCode ?? '', row.detail ?? ''
  ].map(escape).join(','))].join('\n')
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
