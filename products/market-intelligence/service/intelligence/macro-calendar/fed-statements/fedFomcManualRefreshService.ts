import type { MacroCalendarRepository } from '../macroCalendarRepository'
import { fedFomcDecisionRefreshPolicy, type FedFomcDecisionRefreshService } from './fedFomcDecisionRefreshService'

export const fedFomcManualRefreshPolicy = Object.freeze({
  providerId: 'macro-calendar-fed',
  eventFamily: 'fomc',
  requiredConfirmation: true,
  runIdPrefix: 'manual-fomc-decision-refresh:'
})

export type FedFomcManualRefreshService = Readonly<{
  refresh: (input: unknown) => Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>>
}>

export function createFedFomcManualRefreshService(deps: Readonly<{
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf'>
  refresh: FedFomcDecisionRefreshService
  now: () => string
}>): FedFomcManualRefreshService {
  return Object.freeze({
    async refresh(input) {
      if (!isInput(input)) return unavailable()
      const detectedAt = deps.now()
      if (!isCanonicalUtcMillis(detectedAt)) return unavailable()
      const schedule = deps.repository.getEffectiveEventAsOf({ eventKey: input.eventKey, asOf: detectedAt })
      if (!isEligibleSchedule(schedule, input.eventKey, detectedAt)) return unavailable()
      return deps.refresh.refresh({
        detectedAt,
        expectedEventKey: input.eventKey,
        runId: `${fedFomcManualRefreshPolicy.runIdPrefix}${input.eventKey}`
      })
    }
  })
}

function isInput(value: unknown): value is { eventKey: string; confirmed: true } {
  return isExactRecord(value, ['eventKey', 'confirmed']) && typeof value.eventKey === 'string' &&
    fedFomcDecisionRefreshPolicy.eventKeyPattern.test(value.eventKey) && value.confirmed === fedFomcManualRefreshPolicy.requiredConfirmation
}

function isEligibleSchedule(value: unknown, eventKey: string, detectedAt: string): boolean {
  if (!value || typeof value !== 'object') return false
  const schedule = value as Record<string, unknown>
  const scheduledDate = eventKey.slice(fedFomcDecisionRefreshPolicy.eventKeyPrefix.length)
  return schedule.eventKey === eventKey && schedule.releaseGroupKey === eventKey &&
    schedule.providerId === fedFomcManualRefreshPolicy.providerId && schedule.eventFamily === fedFomcManualRefreshPolicy.eventFamily &&
    schedule.scheduledDate === scheduledDate && schedule.scheduledAt === undefined && schedule.lifecycleState !== 'cancelled' && scheduledDate <= detectedAt.slice(0, 10)
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch {
    return false
  }
}

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && fedFomcDecisionRefreshPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value
}

function unavailable() { return Object.freeze({ state: 'unavailable' as const }) }
