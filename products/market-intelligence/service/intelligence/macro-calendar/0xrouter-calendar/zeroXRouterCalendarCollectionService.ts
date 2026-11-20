import type { MacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import { zeroXRouterCalendarEvidenceDescriptors } from '../macroCalendarOfficialSourceRegistry'
import type { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { instant, metadata, type MarketCollectionContext } from './marketCalendarStorageValidation'
import { createZeroXRouterCalendarTransport, type CalendarAcceptedResponse, type CalendarCollectionOutcome } from './zeroXRouterCalendarTransport'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'
import { parseZeroXRouterFinancialEvents } from './zeroXRouterFinancialEventsParser'
import { parseZeroXRouterCentralBankActivities } from './zeroXRouterCentralBankActivitiesParser'
import { isUnknownCountryCode, toAlpha2Country } from '../marketCalendarMetricIdentity'

// Unregistered main-only unit. No connection ownership, timer, second queue or history cache.
const collectionPolicy = Object.freeze({ parserVersion: '0xrouter-calendar-mc2-v1', providerId: '0xrouter' })
type Append = ReturnType<typeof createMarketCalendarEventRepository>['appendCollection']
type EvidenceAppend = MacroCalendarEvidenceStore['append']
type TransportDependencies = Parameters<typeof createZeroXRouterCalendarTransport>[0]

/** 把一批 draft 的国家码分成两类：**真未知** 与 **可归一但别名表还没登记**（用户 2026-11-19）。 */
export function classifyCalendarCountryCodes(
  drafts: readonly Readonly<{ countryCode?: string; placeholderCountryCode?: string }>[]
): Readonly<{ unknown: Record<string, number>; pendingAliases: Record<string, number> }> {
  const unknown = new Map<string, number>()
  const pendingAliases = new Map<string, number>()
  for (const draft of drafts) {
    const code = draft.countryCode
    // 占位码（`ZZ`）在解析层是 `{ state: 'none', reason: 'placeholder' }`，不会带进 draft 的
    // `countryCode`；这里按「源给的原始码」再判一次，让它能被数出来而不是静默归为无国家。
    if (code === undefined) {
      const placeholder = draft.placeholderCountryCode
      if (placeholder !== undefined) unknown.set(placeholder, (unknown.get(placeholder) ?? 0) + 1)
      continue
    }
    if (code.length > 3) continue
    if (isUnknownCountryCode(code)) {
      unknown.set(code, (unknown.get(code) ?? 0) + 1)
      continue
    }
    if (toAlpha2Country(code) !== code) pendingAliases.set(code, (pendingAliases.get(code) ?? 0) + 1)
  }
  const sortDesc = (map: Map<string, number>) =>
    Object.fromEntries([...map].sort((left, right) => right[1] - left[1]))
  return { unknown: sortDesc(unknown), pendingAliases: sortDesc(pendingAliases) }
}

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
    let failureCode: 'archive-unavailable' | 'parse-unavailable' | 'storage-unavailable' | 'metadata-quota-exceeded' = 'archive-unavailable'
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
      // **认不出的国家码：按码聚合打日志**（一次采集几千行，逐行打等于没有日志）。
      // 判据是 `isUnknownCountryCode`（能归成两位就不算未知），**不再手写白名单**——
      // 原来只把 US/DE/JP/GB/CA/EMU 当认识，`NZ`、`IT`、`TW` 这些正当两位码全被算成「未知」，
      // 那份统计因此没有参考价值（用户 2026-11-19 看到的「未知国家码 19 种」就是它）。
      const countries = classifyCalendarCountryCodes(parsed.drafts)
      const unknownEntries = Object.entries(countries.unknown)
      if (unknownEntries.length > 0) {
        console.warn(`[macro-calendar] 未知国家码 ${unknownEntries.length} 种：` + JSON.stringify(countries.unknown))
      }
      const pendingEntries = Object.entries(countries.pendingAliases)
      if (pendingEntries.length > 0) {
        // 能归一、只是别名表还没登记：**不是异常**，info 一行就够，别和真未知混在一个数里。
        console.info(`[macro-calendar] 可归一别名 ${pendingEntries.length} 种，待补别名表：`
          + JSON.stringify(countries.pendingAliases))
      }
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
