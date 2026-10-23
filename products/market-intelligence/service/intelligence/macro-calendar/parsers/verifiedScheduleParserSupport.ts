import { officialMacroCalendarFixtureProvenance } from '../fixtures/officialMacroCalendarProvenance'
import { isFixedMacroCalendarDescriptor } from '../macroCalendarOfficialSourceRegistry'
import type { MacroCalendarScheduleDraft, VerifiedScheduleParserInput } from './verifiedScheduleParserContracts'

export function hasVerifiedScheduleFixture(input: VerifiedScheduleParserInput, descriptorId: string): boolean {
  const provenance = officialMacroCalendarFixtureProvenance.find((item) => item.descriptorId === descriptorId)
  return input.descriptor.descriptorId === descriptorId &&
    isFixedMacroCalendarDescriptor(input.descriptor) &&
    provenance?.status === 200 &&
    provenance.canonicalUrl === input.descriptor.sourceUrl &&
    Boolean(provenance.fixtureFile) &&
    Boolean(input.body.trim())
}

export function isScheduleDraft(draft: MacroCalendarScheduleDraft): boolean {
  return /^US\.(?:FOMC\.\d{4}-\d{2}-\d{2}|(?:PCE|CORE_PCE)\.\d{4}-\d{2}|GDP\.\d{4}-Q[1-4])$/.test(draft.eventKey) &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.scheduledDate) && Boolean(draft.sourceUrl)
}

export function text(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}
