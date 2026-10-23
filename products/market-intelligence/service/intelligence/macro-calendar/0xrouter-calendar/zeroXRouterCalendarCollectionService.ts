import type { MacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import { zeroXRouterCalendarEvidenceDescriptors } from '../macroCalendarOfficialSourceRegistry'
import type { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { instant, metadata, type MarketCollectionContext } from './marketCalendarStorageValidation'
import { createZeroXRouterCalendarTransport, type CalendarAcceptedResponse, type CalendarCollectionOutcome } from './zeroXRouterCalendarTransport'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'
import { parseZeroXRouterFinancialEvents } from './zeroXRouterFinancialEventsParser'
import { parseZeroXRouterCentralBankActivities } from './zeroXRouterCentralBankActivitiesParser'

// Unregistered main-only unit. No connection ownership, timer, second queue or history cache.
const collectionPolicy = Object.freeze({ parserVersion: '0xrouter-calendar-mc2-v1', providerId: '0xrouter' })
type Append = ReturnType<typeof createMarketCalendarEventRepository>['appendCollection']
type EvidenceAppend = MacroCalendarEvidenceStore['append']
type TransportDependencies = Parameters<typeof createZeroXRouterCalendarTransport>[0]

export function createZeroXRouterCalendarCollectionService(deps: Readonly<{
  requestGovernanceQueue: TransportDependencies['requestGovernanceQueue']
  getApiKey: TransportDependencies['getApiKey']
  requestJsonBody: NonNullable<TransportDependencies['requestJsonBody']>
  now: () => Date
  createCollectionId: () => string
  evidence: Pick<MacroCalendarEvidenceStore, 'reserve' | 'release'> & {
    append: (...args: Parameters<EvidenceAppend>) => ReturnType<EvidenceAppend> | Promise<ReturnType<EvidenceAppend>>
  }
  createRepository: (resolveCollectionContext: (collectionId: string) => MarketCollectionContext | undefined) => {
    appendCollection: (input: Parameters<Append>[0]) => ReturnType<Append> | Promise<ReturnType<Append>>
  }
}>) {
  let active: { collectionId: string; context: MarketCollectionContext } | undefined
  const repository = deps.createRepository(id => active?.collectionId === id ? active.context : undefined)

  async function consume(input: CalendarAcceptedResponse): Promise<CalendarCollectionOutcome> {
    let reservation: ReturnType<MacroCalendarEvidenceStore['reserve']>
    let failureCode: 'archive-unavailable' | 'parse-unavailable' | 'storage-unavailable' = 'archive-unavailable'
    try {
      const descriptor = zeroXRouterCalendarEvidenceDescriptors.find(item => item.descriptorId === input.descriptorId)
      if (!descriptor || !instant(input.detectedAt)) return { state: 'unavailable', failureCode }
      const collectionId = deps.createCollectionId()
      if (!metadata(collectionId)) return { state: 'unavailable', failureCode: 'storage-unavailable' }
      reservation = deps.evidence.reserve(input.acceptedBytes)
      if (!reservation) return { state: 'unavailable', failureCode }
      const reference = await deps.evidence.append({ descriptor, sourceUrl: descriptor.sourceUrl,
        detectedAt: input.detectedAt, body: input.body, payloadFormat: 'json', runId: collectionId,
        parserVersion: collectionPolicy.parserVersion,
        response: { status: input.status, contentType: input.contentType, locale: input.locale }
      }, reservation)
      if (!reference || reference.providerId !== descriptor.providerId || reference.descriptorId !== input.descriptorId) {
        return { state: 'unavailable', failureCode }
      }
      failureCode = 'parse-unavailable'
      const body: unknown = JSON.parse(input.body)
      const parsed = input.descriptorId === 'macro-calendar-0xrouter-economic-data'
        ? parseZeroXRouterEconomicData(body, input.locale)
        : input.descriptorId === 'macro-calendar-0xrouter-financial-events'
          ? parseZeroXRouterFinancialEvents(body, input.locale)
          : parseZeroXRouterCentralBankActivities(body, input.locale)
      if (parsed.state !== 'succeeded') return { state: 'unavailable', failureCode }
      failureCode = 'storage-unavailable'
      const scope = { providerId: collectionPolicy.providerId, descriptorId: input.descriptorId, locale: input.locale, month: input.month }
      // Archive provider namespace is checked above; MC3 uses its canonical provider identity.
      active = { collectionId, context: { ...scope, detectedAt: input.detectedAt,
        evidence: { providerId: scope.providerId, descriptorId: scope.descriptorId,
          rawRecordId: reference.rawRecordId, evidenceHash: reference.evidenceHash } } }
      const written = await repository.appendCollection({ ...scope, collectionId,
        parserVersion: collectionPolicy.parserVersion, parseResult: parsed })
      if (written.state !== 'succeeded') return { state: 'unavailable',
        // The repository already named the verdict; folding it here would erase the one
        // signal the panel needs to tell "shared calendar is full" from "storage is down".
        failureCode: written.failureCode === 'storage-pressure' ? 'storage-pressure' : 'storage-unavailable' }
      const { inputRows, skippedRows } = parsed.diagnostics
      return { state: 'succeeded', inputRows, skippedRows, storedRows: parsed.drafts.length,
        status: !inputRows ? 'success-empty' : inputRows === skippedRows ? 'all-skipped' : skippedRows ? 'partial' : 'success' }
    } catch {
      return { state: 'unavailable', failureCode }
    } finally {
      active = undefined
      if (reservation) deps.evidence.release(reservation)
    }
  }

  // Explicit binding prevents the service from silently degrading to transport-only mode.
  return createZeroXRouterCalendarTransport({ requestGovernanceQueue: deps.requestGovernanceQueue,
    getApiKey: deps.getApiKey, requestJsonBody: deps.requestJsonBody, now: deps.now, consumeAcceptedResponse: consume })
}
