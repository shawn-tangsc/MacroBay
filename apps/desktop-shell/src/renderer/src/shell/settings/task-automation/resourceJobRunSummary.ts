import type { JobScheduleView } from '@platform/jobs'

/**
 * 资源任务（`@platform/jobs`）的运行口径：与「定时任务投递」是两套完全不同的语义，
 * 只按每个 job 投影里的 `lastOutcome` / `lastRunAt` 做客户端聚合，不做任何跨口径合并。
 */
export type ResourceJobRunSummary = {
  total: number
  succeeded: number
  failed: number
  skipped: number
  never: number
  /** 所有 job 最近一次运行时间的最大值；全部未运行过则为 null。 */
  latestRunAt: string | null
}

const EMPTY_SUMMARY: ResourceJobRunSummary = {
  total: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  never: 0,
  latestRunAt: null
}

export function summarizeResourceJobRuns(
  items: readonly Pick<JobScheduleView, 'lastOutcome' | 'lastRunAt'>[]
): ResourceJobRunSummary {
  if (items.length === 0) return { ...EMPTY_SUMMARY }

  let succeeded = 0
  let failed = 0
  let skipped = 0
  let never = 0
  let latest: number | null = null

  for (const item of items) {
    const at = item.lastRunAt ? Date.parse(item.lastRunAt) : Number.NaN
    const hasRun = item.lastOutcome !== 'never' && !Number.isNaN(at)
    if (!hasRun) never += 1
    else if (item.lastOutcome === 'success') succeeded += 1
    else if (item.lastOutcome === 'failed') failed += 1
    else skipped += 1

    if (Number.isNaN(at)) continue
    if (latest === null || at > latest) latest = at
  }

  return {
    total: items.length,
    succeeded,
    failed,
    skipped,
    never,
    latestRunAt: latest === null ? null : new Date(latest).toISOString()
  }
}
