import type { AnalysisRun } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'

/**
 * 「失败页」的读口（服务侧）。
 *
 * 时间轴的未发布行只在**首页**补最多 20 条（`marketAnalysisTimelineLimits.unpublishedItems`），
 * 所以历史失败看不到全。这个读口单独按运行表分页，把每一行映射成时间轴条目的形状，
 * 让渲染侧仍用 `sanitizePage` 校验——**不给 `listTimeline` 加状态筛选**：它的游标基于已发布行
 * 的 `(occurred_at, id)`，失败行只能按运行的 `(queued_at, id)`，两种游标语义不能混。
 *
 * `failureCode` 只发渲染侧文案表认得的码；未知码收敛成 `analysis-provider-error`
 * （与 `getLatestAttempt` 同一口径），**绝不把原始码印给读者**。
 */
export type FailedRunTimelineEntry = Readonly<{
  id: string
  eventGroupId: string
  analysisRunId: string
  kind: 'analysis' | 'review'
  status: 'failed'
  occurredAt: string
  summaryRef: null
  safeTitle: ''
  safeExcerpt: null
  direction: null
  version: 1
  /** 同一次运行稳定不变的键；界面按 `analysisRunId ?? id` 认行。 */
  runKey: string
  failureCode: string | null
}>

export type FailedRunPage = Readonly<{
  schemaVersion: 1
  items: readonly FailedRunTimelineEntry[]
  nextCursor: string | null
}>

const KNOWN_FAILURE_CODES: ReadonlySet<string> = new Set<string>(Object.values(MARKET_ANALYSIS_ERROR_CODES))

export function failedRunTimelineEntry(run: AnalysisRun): FailedRunTimelineEntry {
  return {
    // `run:` 前缀与时间轴里「补出来的未发布行」同一身份，避免与已发布时间轴 id 撞。
    id: `run:${run.id}`,
    eventGroupId: run.eventGroupId,
    analysisRunId: run.id,
    kind: run.analysisPhase === 'review' ? 'review' : 'analysis',
    status: 'failed',
    occurredAt: run.completedAt ?? run.startedAt ?? run.queuedAt,
    summaryRef: null,
    // 失败行没有摘要：标题由状态词承担（与时间轴补出来的失败行同一约定）。
    safeTitle: '',
    safeExcerpt: null,
    direction: null,
    version: 1,
    runKey: run.id,
    failureCode: run.failureCode === null
      ? null
      : KNOWN_FAILURE_CODES.has(run.failureCode) ? run.failureCode : MARKET_ANALYSIS_ERROR_CODES.providerError
  }
}

export function createAnalysisFailedRunReader(
  repository: Pick<MarketAnalysisRepository, 'listFailedRuns'>
): Readonly<{ list: (input: Readonly<{ cursor?: string | null; limit?: number }>) => FailedRunPage }> {
  return {
    list(input) {
      const page = repository.listFailedRuns(input)
      return { schemaVersion: 1, items: page.items.map(failedRunTimelineEntry), nextCursor: page.nextCursor }
    }
  }
}
