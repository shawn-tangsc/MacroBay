import type { MacroCalendarRevision, MacroCalendarSurprise } from './macroCalendarContracts'
import { isMacroCalendarVisibleAsOf, macroCalendarConsensusFallback, macroCalendarProjectionPolicy } from './macroCalendarPolicy'

export type MacroCalendarProjectionEvent = Pick<MacroCalendarRevision, 'eventKey' | 'releaseGroupKey' | 'eventFamily' | 'periodKey' | 'lifecycleState' | 'scheduledDate' | 'scheduledAt' | 'publishedAt' | 'detectedAt' | 'actual' | 'previous' | 'providerId' | 'evidenceRefs' | 'caveats'> & {
  consensus: MacroCalendarProjectionConsensus
  consensusState: 'available' | 'unavailable'
  surprise: MacroCalendarSurprise
}

/**
 * Consensus as the projection carries it. The official revisions have none, while a
 * market calendar event can supply a real value.
 */
export type MacroCalendarProjectionConsensus = { displayValue: string; numericValue?: number; unit?: string } | null

export function projectMacroCalendarMonth(input: { asOf: string; monthStart: string; monthEndExclusive: string; revisions: MacroCalendarRevision[] }): { events: MacroCalendarProjectionEvent[]; caveats: string[] } {
  if (!isMacroCalendarVisibleAsOf(input.asOf, input.asOf)) return { events: [], caveats: [macroCalendarProjectionPolicy.invalidAsOfCaveat] }
  const selected = new Map<string, MacroCalendarRevision>()
  for (const revision of input.revisions.filter((item) => isMacroCalendarVisibleAsOf(item.detectedAt, input.asOf)).sort(byEffectiveRevision)) {
    if (!selected.has(revision.eventKey)) selected.set(revision.eventKey, revision)
  }
  const events = [...selected.values()]
    .filter((item) => item.scheduledDate >= input.monthStart && item.scheduledDate < input.monthEndExclusive)
    .map((item) => ({ ...item, ...macroCalendarConsensusFallback, caveats: [...item.caveats, macroCalendarProjectionPolicy.consensusUnavailableCaveat] }))
  return { events, caveats: [] }
}

function byEffectiveRevision(left: MacroCalendarRevision, right: MacroCalendarRevision): number {
  return right.detectedAt.localeCompare(left.detectedAt) || right.recordedAt.localeCompare(left.recordedAt) || right.revisionId.localeCompare(left.revisionId)
}
