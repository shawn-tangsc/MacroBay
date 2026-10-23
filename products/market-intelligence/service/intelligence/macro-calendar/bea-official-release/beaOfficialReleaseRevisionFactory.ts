import { createHash } from 'node:crypto'

import type { MacroCalendarEvidenceRef, MacroCalendarRevision, MacroCalendarValue } from '../macroCalendarContracts'
import type { BeaReleaseGroup, BeaOfficialReleaseRssIdentity } from './beaOfficialReleaseRssRecognizer'
import type { BeaOfficialReleasePageFacts } from './beaOfficialReleasePageParser'

export const beaOfficialReleaseRevisionPolicy = Object.freeze({ providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-release-rss', parserVersion: 'bea-official-release-value-v1', pceUnit: 'percent-yoy', gdpUnit: 'percent-saar', caveats: ['bea-official-rss-release-page'] })

export function createBeaOfficialReleaseRevisions(input: Readonly<{ group: BeaReleaseGroup; rss: BeaOfficialReleaseRssIdentity; facts: BeaOfficialReleasePageFacts; evidence: { rss: { rawRecordId: string; evidenceHash: string }; page: { rawRecordId: string; evidenceHash: string } }; detectedAt: string }>): MacroCalendarRevision[] | undefined {
  const values = input.group.kind === 'pce-core' && 'pcePercent' in input.facts
    ? [{ eventKey: input.group.eventKeys[0], family: 'pce' as const, value: input.facts.pcePercent, unit: beaOfficialReleaseRevisionPolicy.pceUnit }, { eventKey: input.group.eventKeys[1], family: 'core-pce' as const, value: input.facts.corePcePercent, unit: beaOfficialReleaseRevisionPolicy.pceUnit }]
    : input.group.kind === 'gdp' && 'gdpPercent' in input.facts ? [{ eventKey: input.group.eventKeys[0], family: 'gdp' as const, value: input.facts.gdpPercent, unit: beaOfficialReleaseRevisionPolicy.gdpUnit }] : undefined
  if (!values) return undefined
  return values.map((item) => revision(input, item.eventKey, item.family, numeric(item.value, item.unit), input.group.kind === 'gdp' && input.rss.previousPercent !== undefined ? numeric(input.rss.previousPercent, beaOfficialReleaseRevisionPolicy.gdpUnit) : undefined))
}
function revision(input: Parameters<typeof createBeaOfficialReleaseRevisions>[0], eventKey: string, eventFamily: MacroCalendarRevision['eventFamily'], actual: MacroCalendarValue, previous: MacroCalendarValue | undefined): MacroCalendarRevision {
  const evidenceHash = hash(`${input.evidence.rss.evidenceHash}\n${input.evidence.page.evidenceHash}`)
  const evidenceRefs: MacroCalendarEvidenceRef[] = [{ providerId: beaOfficialReleaseRevisionPolicy.providerId, descriptorId: beaOfficialReleaseRevisionPolicy.descriptorId, sourceUrl: 'https://apps.bea.gov/rss/rss.xml', rawRecordId: input.evidence.rss.rawRecordId, evidenceHash: input.evidence.rss.evidenceHash, detectedAt: input.detectedAt, fieldKinds: ['actual'] }, { providerId: beaOfficialReleaseRevisionPolicy.providerId, descriptorId: 'macro-calendar-bea-release-page', sourceUrl: input.rss.officialPageUrl, rawRecordId: input.evidence.page.rawRecordId, evidenceHash: input.evidence.page.evidenceHash, detectedAt: input.detectedAt, fieldKinds: ['actual'] }]
  const semantic = { eventKey, releaseGroupKey: input.group.releaseGroupKey, eventFamily, eventNameKey: eventFamily, countryCode: 'US' as const, importance: 'high' as const, periodKey: input.group.periodKey, lifecycleState: 'released' as const, revisionKind: 'official-release' as const, scheduledDate: input.group.scheduledDate, ...(input.group.scheduledAt ? { scheduledAt: input.group.scheduledAt } : {}), publishedAt: input.rss.publishedAt, detectedAt: input.detectedAt, recordedAt: input.detectedAt, actual, ...(previous ? { previous } : {}), providerId: beaOfficialReleaseRevisionPolicy.providerId, descriptorId: beaOfficialReleaseRevisionPolicy.descriptorId, sourceUrl: beaOfficialReleaseEvidenceUrl(input), rawRecordId: input.evidence.rss.rawRecordId, evidenceHash, evidenceRefs, parserVersion: beaOfficialReleaseRevisionPolicy.parserVersion, caveats: [...beaOfficialReleaseRevisionPolicy.caveats] }
  return { ...semantic, revisionId: hash(JSON.stringify([semantic.eventKey, semantic.actual, semantic.previous, semantic.publishedAt, semantic.evidenceHash])), snapshotHash: 'calculated-by-repository' }
}
function beaOfficialReleaseEvidenceUrl(input: Parameters<typeof createBeaOfficialReleaseRevisions>[0]): string { return input.rss.officialPageUrl }
function numeric(value: number, unit: string): MacroCalendarValue { return { numericValue: value, displayValue: `${value.toFixed(1)}%`, unit } }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
