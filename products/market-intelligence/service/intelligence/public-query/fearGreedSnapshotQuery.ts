import {
  fearGreedSnapshotPolicy,
  isCanonicalFearGreedSnapshotTime,
  type FearGreedSnapshotQueryInput,
  type FearGreedSnapshotResult
} from '../../../contracts/intelligenceQueryContracts'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import { readFearGreedDailyPoints } from './fearGreedDailyPoints'

export type FearGreedSnapshotQueryDependencies = {
  pipeline: Pick<IntelligencePipeline, 'listItems' | 'listMetricEvents'>
}

/**
 * The latest day only. The day rule itself lives in `readFearGreedDailyPoints`, which the card's
 * series reads too: one implementation answers "which day is this point", so the snapshot and the
 * curve cannot disagree about the 19th.
 */
export function queryFearGreedSnapshot(
  input: FearGreedSnapshotQueryInput & FearGreedSnapshotQueryDependencies
): FearGreedSnapshotResult {
  if (!isCanonicalFearGreedSnapshotTime(input.asOf)) return unavailable()

  const read = readFearGreedDailyPoints({ pipeline: input.pipeline, asOf: input.asOf })
  if (read.state === 'unavailable') return unavailable()
  if (read.state === 'empty') return { state: 'empty', asOf: input.asOf }

  const latest = read.days[0]
  if (!latest) return unavailable()
  return { state: 'available', asOf: input.asOf, score: latest.score, bucket: latest.bucket, observedAt: latest.observedAt }
}

function unavailable(): Extract<FearGreedSnapshotResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: fearGreedSnapshotPolicy.unavailableFailureCode }
}