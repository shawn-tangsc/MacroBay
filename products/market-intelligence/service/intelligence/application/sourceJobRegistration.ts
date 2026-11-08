import { intelligenceCollectJobId } from './sourceRuntimeOrchestrator'

type JobAwareSource = {
  sourceId: string
  kind: string
  collection: string
}

const zeroXRouterFeedKeys: Readonly<Record<string, string>> = {
  'macro-calendar-0xrouter-economic-data': 'economic-data',
  'macro-calendar-0xrouter-financial-events': 'financial-events',
  'macro-calendar-0xrouter-central-bank-activities': 'central-bank-activities'
}

/** Sources whose automatic collection is owned by the job runtime. */
export function needsSourceJob(source: JobAwareSource): boolean {
  return source.collection === 'adapter'
    || source.collection === 'job'
    || source.kind === 'official-calendar'
    || source.kind === 'market-calendar'
}

/**
 * The job definition ids that can own a source. The collect job is the default
 * for polling sources; calendar feeds have their own per-feed definitions.
 */
export function sourceJobIds(source: JobAwareSource): readonly string[] {
  const ids = [intelligenceCollectJobId(source.sourceId)]
  const feedKey = zeroXRouterFeedKeys[source.sourceId]
  if (feedKey) ids.push(`market-intelligence.refreshMarketCalendar.automatic.${feedKey}`)
  // BLS 官方日历由自己的同步作业拥有（`blsScheduleAndValuesScheduler.ts`）。它 2026-11-08 起
  // 已停止排期，这里仍要列出它的 id：状态只从 `listSchedules()` 读，列不出来就又得靠开关猜。
  if (source.sourceId === 'macro-calendar-bls') ids.push('market-intelligence.syncBlsScheduleAndValues.automatic')
  return ids
}

/**
 * 「这个源现在有没有自动任务」**只认 `listSchedules()`**。
 *
 * 以前这里还有一条兜底：`已启用 && 需要作业` 就算「已注册」。那是从开关反推状态，源一旦按决定
 * 停掉自动任务，页面会继续显示「已注册自动任务」——正好是假的。现在没有排期就是没排期。
 */
export function projectJobRegistration(
  sources: readonly JobAwareSource[],
  scheduledDefinitionIds: ReadonlySet<string>
): Readonly<Record<string, boolean>> {
  const result: Record<string, boolean> = {}
  for (const source of sources) {
    result[source.sourceId] = sourceJobIds(source).some((id) => scheduledDefinitionIds.has(id))
  }
  return result
}
