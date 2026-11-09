import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPeriodRun } from './dailyBriefingService'

/**
 * 一张运行记录行（`daily_briefing_period_runs`）的解析。
 *
 * 从 store 里分出来只为一件事：store 已经到 500 行的上限，而运行记录的**行形状**（v3 没有
 * `locale`、v4 有）与「怎么把一行变成 `DailyBriefingPeriodRun`」是自成一体的纯函数，不碰
 * 数据库句柄。0.4.2 #18 加 `locale` 时把这部分留在了 store 里，于是随提交一起超过了上限。
 */
export type RunRow = Readonly<{
  edition_date: string
  period_id: string
  /** 旧形状没有这一列；迁到 v4 之后每行都有（坏数据兜底为 `'unknown'`）。 */
  locale?: string
  expected_locales: string
  primary_requested: string
  primary_used: string
  fallback_reason: string | null
  snapshot_id: string
  snapshot_hash: string
  content_version: number
  writing_rounds: number
  direction: string | null
  edition_rows: string | null
  state: string
  started_at: string
  finished_at: string | null
}>

const runStates = ['running', 'published', 'partial', 'failed'] as const

export function parseRun(row: RunRow | undefined): DailyBriefingPeriodRun | undefined {
  if (!row) return undefined
  let locales: unknown
  try {
    locales = JSON.parse(row.expected_locales)
  } catch {
    return undefined
  }
  if (!Array.isArray(locales) || locales.length === 0 || locales.some((locale) => locale !== 'zh-CN' && locale !== 'en-US')) return undefined
  const state = runStates.find((value) => value === row.state)
  if (!state) return undefined
  return Object.freeze({
    date: row.edition_date,
    periodId: row.period_id,
    // 旧形状（迁移没跑成）没有这一列：读作 `unknown`，不假装是哪一种语言。
    locale: row.locale === 'zh-CN' || row.locale === 'en-US' ? row.locale : 'unknown',
    expectedLocales: Object.freeze(locales as DailyBriefingLocale[]),
    primaryRequested: row.primary_requested,
    primaryUsed: row.primary_used === 'en-US' ? 'en-US' : 'zh-CN',
    ...(row.fallback_reason ? { fallbackReason: row.fallback_reason } : {}),
    snapshotId: row.snapshot_id,
    snapshotHash: row.snapshot_hash,
    contentVersion: Number(row.content_version),
    writingRounds: Number(row.writing_rounds),
    direction: (row.direction ?? 'undecided') as DailyBriefingPeriodRun['direction'],
    editionRows: Object.freeze(parseRows(row.edition_rows)),
    state,
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {})
  })
}

function parseRows(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
