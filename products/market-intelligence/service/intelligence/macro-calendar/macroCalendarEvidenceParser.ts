import { parseBlsObservedValues, type BlsObservedValueDraft } from './bls-observations/blsObservedValuesParser'
import type { MacroCalendarProviderId } from './macroCalendarContracts'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { parseBeaReleaseSchedule } from './parsers/beaReleaseScheduleParser'
import { parseFedFomcSchedule } from './parsers/fedFomcScheduleParser'
import type { MacroCalendarScheduleDraft } from './parsers/verifiedScheduleParserContracts'

export type MacroCalendarEvidenceParserInput = { descriptorId: string; body: string }
export type MacroCalendarSanitizedScheduleDraft = Omit<MacroCalendarScheduleDraft, 'sourceUrl'>

export type MacroCalendarEvidenceParserResult =
  | { providerId: MacroCalendarProviderId; descriptorId: string; parserId: string; kind: 'schedule-drafts'; drafts: MacroCalendarSanitizedScheduleDraft[] }
  | { providerId: MacroCalendarProviderId; descriptorId: string; parserId: string; kind: 'observed-value-drafts'; drafts: BlsObservedValueDraft[] }
  | { descriptorId: string; state: 'skipped'; failureCode: 'descriptor-not-found' }
  | { providerId: MacroCalendarProviderId; descriptorId: string; parserId: string; state: 'skipped'; failureCode: 'parser-unavailable' }
  | { providerId: MacroCalendarProviderId; descriptorId: string; parserId: string; state: 'failed'; failureCode: 'payload-invalid' | 'parser-output-empty' }

export function parseMacroCalendarEvidence(input: MacroCalendarEvidenceParserInput): MacroCalendarEvidenceParserResult {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(input.descriptorId)
  if (!descriptor) return { descriptorId: input.descriptorId, state: 'skipped', failureCode: 'descriptor-not-found' }
  if (descriptor.descriptorId === 'macro-calendar-fed-schedule') return scheduleResult(descriptor.providerId, descriptor.descriptorId, descriptor.parserId, parseFedFomcSchedule({ descriptor, body: input.body }))
  if (descriptor.descriptorId === 'macro-calendar-bea-schedule') return scheduleResult(descriptor.providerId, descriptor.descriptorId, descriptor.parserId, parseBeaReleaseSchedule({ descriptor, body: input.body }))
  if (descriptor.descriptorId === 'macro-calendar-bls-values') return blsResult(descriptor.providerId, descriptor.descriptorId, descriptor.parserId, input.body)
  return { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, parserId: descriptor.parserId, state: 'skipped', failureCode: 'parser-unavailable' }
}

function scheduleResult(providerId: MacroCalendarProviderId, descriptorId: string, parserId: string, drafts: MacroCalendarScheduleDraft[]): MacroCalendarEvidenceParserResult {
  return drafts.length > 0
    ? { providerId, descriptorId, parserId, kind: 'schedule-drafts', drafts: drafts.map(withoutSourceUrl) }
    : { providerId, descriptorId, parserId, state: 'failed', failureCode: 'parser-output-empty' }
}

function withoutSourceUrl({ sourceUrl: _sourceUrl, ...draft }: MacroCalendarScheduleDraft): MacroCalendarSanitizedScheduleDraft {
  return draft
}

function blsResult(providerId: MacroCalendarProviderId, descriptorId: string, parserId: string, body: string): MacroCalendarEvidenceParserResult {
  let payload: unknown
  try { payload = JSON.parse(body) } catch { return { providerId, descriptorId, parserId, state: 'failed', failureCode: 'payload-invalid' } }
  const drafts = parseBlsObservedValues(payload)
  return drafts.length > 0
    ? { providerId, descriptorId, parserId, kind: 'observed-value-drafts', drafts }
    : { providerId, descriptorId, parserId, state: 'failed', failureCode: 'parser-output-empty' }
}
