import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { readGenerationTrace, type GenerationTrace } from './dailyBriefingGenerationTrace'

/** Why a manual regeneration did not produce today's edition. `code` is the service's failure code. */
export type BriefingRegenerateFailure = Readonly<{ code?: string; generationTrace?: GenerationTrace }>

/**
 * One manual "重新生成" attempt, with its three endings: a document, a typed failure, or a thrown
 * call. The page only applies what comes back; the request shape and the failure decoding live here,
 * because they are the part worth testing on their own.
 */
export async function runBriefingRegenerate(deps: Readonly<{
  client: Pick<DailyBriefingClient, 'regenerate'>
  /** The zone the run's day boundary uses; an unreadable stored zone falls back to UTC. */
  timeZone: string
  locale: DailyBriefingDocument['edition']['locale']
  /** Which period of today to run; absent means the page's only one. */
  periodId?: string
  /** A one-off cutoff and window from the manual dialog; absent runs the period as scheduled. */
  generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
}>): Promise<Readonly<{ kind: 'available'; document: DailyBriefingDocument } | { kind: 'failed'; failure: BriefingRegenerateFailure }>> {
  try {
    const result = await deps.client.regenerate({
      locale: deps.locale, timeZone: deps.timeZone,
      ...(deps.periodId === undefined ? {} : { periodId: deps.periodId }),
      ...(deps.generation === undefined ? {} : { generation: deps.generation })
    })
    if (result.state === 'available') return { kind: 'available', document: result.document }
    const generationTrace = readGenerationTrace((result as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
    return { kind: 'failed', failure: { code: result.failureCode, ...(generationTrace ? { generationTrace } : {}) } }
  } catch {
    return { kind: 'failed', failure: {} }
  }
}
