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
  return ids
}
