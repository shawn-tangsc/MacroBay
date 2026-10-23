import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import {
  MACRO_ECONOMIC_CALENDAR_IPC_METHODS
} from '../../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroCalendarProviderSettingsService } from '../macroCalendarProviderSettingsService'
import { createMacroEconomicCalendarQueryService, type MacroCalendarReleaseTimeOverrides } from '../macroEconomicCalendarQueryService'
import type { MacroCalendarReleaseTimeOverrideCache, MacroCalendarReleaseTimeOverrideStore } from '../macroCalendarReleaseTimeOverrideStore'
import type { MacroCalendarRepository } from '../macroCalendarRepository'
import type { ManualBlsIcsImportService } from '../bls-ics-manual/blsManualIcsImportService'
import type { BlsEmploymentMvpRefreshService } from '../bls-employment-refresh/blsEmploymentMvpRefreshService'
import type { BlsScheduleAndValuesSyncWorkflow } from '../bls-schedule-catch-up/blsScheduleAndLatestValuesSyncWorkflow'
import type { FedFomcManualRefreshService } from '../fed-statements/fedFomcManualRefreshService'
import { isMarketCalendarPage, isMarketCalendarQuery, isMarketCalendarScope, isMarketCalendarRefreshResult,
  marketCalendarPublicPolicy } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { createMacroCalendarLinkedQueryService, type SafeMarketQuery } from '../macroCalendarLinkedQueryService'
import { linkZeroXRouterEvent, zeroXRouterOfficialEventLinks } from '../0xrouter-calendar/zeroXRouterOfficialEventLinkRegistry'
import { createMacroCalendarWriteActions } from '../macroCalendarWriteActions'
import {
  isEmpty,
  isProviderInput,
  providerUnavailable,
  safeProviderPage,
  safeProviderSchedule
} from '../macroCalendarResultGuards'

const productId = 'market-intelligence'

export function registerMacroEconomicCalendarIpc(
  register: ProductIpcRegistrar,
  repository: Pick<MacroCalendarRepository, 'listEffectiveMonthAsOf' | 'getEffectiveEventAsOf'>,
  manualBlsIcs: ManualBlsIcsImportService,
  providerSettings?: MacroCalendarProviderSettingsService,
  connection?: {
    testProviderConnection?: (providerId: unknown) => unknown
    /** The reader's own release times: the durable store, and the synchronous view queries read. */
    releaseTimeOverrides?: MacroCalendarReleaseTimeOverrideCache
    releaseTimeOverrideStore?: MacroCalendarReleaseTimeOverrideStore
  },
  blsEmploymentRefresh?: BlsEmploymentMvpRefreshService,
  blsEmploymentSchedule?: BlsScheduleAndValuesSyncWorkflow,
  fedFomcRefresh?: FedFomcManualRefreshService,
  market?: SafeMarketQuery & { refresh: (input: unknown) => unknown }
): void {
  const releaseTimeOverrides = connection?.releaseTimeOverrides
  // Seed the synchronous view before the first query; until it lands, a row falls back to its
  // published time or its convention, which is the correct answer for "not yet known to be edited".
  void releaseTimeOverrides?.refresh()
  const service = createMacroEconomicCalendarQueryService({
    repository, ...(releaseTimeOverrides === undefined ? {} : { releaseTimeOverrides })
  })
  const linkedMarket = market ? createMacroCalendarLinkedQueryService({ official: service, market,
    link: (official, marketEvent, evidence) => {
      if (!evidence || typeof evidence !== 'object') return undefined
      const source = evidence as Record<string, unknown>
      const admitted = zeroXRouterOfficialEventLinks.find(link => link.sourceEventId === source.sourceEventId && link.evidenceHash === source.evidenceHash && link.locale === source.locale)
      if (!admitted || !admitted.providerScheduledAt) return undefined
      return linkZeroXRouterEvent({ eventKey: official.eventKey, releaseGroupKey: official.releaseGroupKey,
        eventFamily: official.eventFamily, periodKey: official.periodKey, countryCode: official.countryCode,
        scheduledDate: official.scheduledDate, scheduledAt: official.scheduledAt, unit: official.actual?.unit,
        actual: official.actual, previous: official.previous, publishedAt: official.publishedAt },
      { providerId: String(source.providerId), descriptorId: String(source.descriptorId), locale: String(source.locale) as 'zh' | 'en',
        sourceEventId: String(source.sourceEventId), eventKey: marketEvent.eventKey, indicatorId: admitted.indicatorId,
        countryCode: marketEvent.countryCode, periodKey: admitted.periodKey, unit: admitted.unit,
        scheduledDate: admitted.providerScheduledAt?.slice(0, 10),
        scheduledAt: marketEvent.scheduledAt, sourceObservedAt: marketEvent.sourceObservedAt, consensus: marketEvent.consensus,
        providerPrevious: marketEvent.providerPrevious, providerActual: marketEvent.providerActual }, zeroXRouterOfficialEventLinks,
      String(source.locale) as 'zh' | 'en') ? {
        officialEventKey: official.eventKey, officialPeriodKey: official.periodKey, officialScheduledDate: official.scheduledDate,
        officialScheduledAt: official.scheduledAt ?? null, officialDetectedAt: official.detectedAt,
        timeDisplaySource: official.scheduledAt ? 'official-scheduled' : 'provider-scheduled', displayScheduledAt: official.scheduledAt ?? marketEvent.scheduledAt,
        officialActual: official.actual ? { displayValue: official.actual.displayValue } : null,
        officialPrevious: official.previous ? { displayValue: official.previous.displayValue } : null
      } : undefined
    } }) : undefined
  // Every calendar write, on the agent surface and on this IPC surface, comes from one factory.
  const actions = createMacroCalendarWriteActions({
    manualBlsIcs,
    providerSettings,
    connection,
    blsEmploymentRefresh,
    blsEmploymentSchedule,
    fedFomcRefresh
  })
  register(productId, marketCalendarPublicPolicy.methods.query, async payload => {
    try {
      if (isMarketCalendarQuery(payload) && market) {
        const value = await (linkedMarket?.queryMonth(payload) ?? market.queryMonth(payload))
        if (isMarketCalendarPage(value, payload)) return value
      }
    } catch {}
    return { state: 'unavailable', failureCode: 'query-unavailable' }
  })
  register(productId, marketCalendarPublicPolicy.methods.refresh, async payload => {
    try {
      if (isMarketCalendarScope(payload) && market) {
        const value = await market.refresh(payload)
        if (isMarketCalendarRefreshResult(value)) return value
      }
    } catch {}
    return { state: 'unavailable', failureCode: 'readiness-unavailable', sources: [] }
  })
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth, async (payload) => service.queryMonth(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getEventDetail, async (payload) => service.getEventDetail(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.setReleaseTime, async (payload) => actions.setReleaseTime(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.clearReleaseTime, async (payload) => actions.clearReleaseTime(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs, async (payload) => actions.previewManualIcs(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs, async (payload) => actions.importManualIcs(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease, async (payload) => actions.refreshBlsEmployment(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision, async (payload) => actions.refreshFedFomc(payload))
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule, async (payload) => actions.syncBlsSchedule(payload))
  if (providerSettings) {
    register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState, async (payload) => { try { return isEmpty(payload) ? safeProviderPage(() => providerSettings.getPageState()) : providerUnavailable() } catch { return providerUnavailable() } })
    register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile, async (payload) => actions.saveProviderProfile(payload))
    register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow, async (payload) => actions.runProviderNow(payload))
    register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth, async (payload) => { try { return isProviderInput(payload) ? safeProviderPage(() => providerSettings.getProviderHealth(payload.providerId)) : providerUnavailable() } catch { return providerUnavailable() } })
    register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderSchedule, async (payload) => { try { return isProviderInput(payload) ? safeProviderSchedule(() => providerSettings.getProviderSchedule(payload.providerId), payload.providerId) : providerUnavailable() } catch { return providerUnavailable() } })
  }
  register(productId, MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection, async (payload) => actions.testProviderConnection(payload))
}
