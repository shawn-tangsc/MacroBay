import type { MacroCalendarRepository } from '../macroCalendarRepository'
import type { BlsScheduleGroupDescriptor, BlsEmploymentScheduleSyncResult, BlsEmploymentScheduleSyncService } from '../bls-python/blsEmploymentScheduleSyncService'

export const blsScheduleTriggeredCatchUpPolicy = Object.freeze({
  familyOrder: ['cpi', 'employment'] as const,
  maximumCandidateGroups: 2,
  maximumValueRequests: 2,
  maximumExactReads: 5,
  completionBudgetMs: 39_000
})

export type BlsScheduleAndValuesResult =
  | Readonly<{
    state: 'completed'
    schedule: 'updated' | 'unchanged'
    values: Readonly<{ cpi: 'updated' | 'current' | 'not-required' | 'unavailable'; employment: 'updated' | 'current' | 'not-required' | 'unavailable' }>
  }>
  | Readonly<{ state: 'unavailable' }>

export type BlsAutomaticRefreshInput = Readonly<{
  family: 'cpi' | 'employment'
  eventKey: string
  period: `${number}-M${string}`
  scheduledDate: string
  workflowAsOf: string
  trigger: 'schedule-latest-catch-up'
}>
export type BlsScheduleAndValuesSyncWorkflow = Readonly<{ sync: (input: unknown) => Promise<BlsScheduleAndValuesResult> }>

type Dependencies = Readonly<{
  schedule?: BlsEmploymentScheduleSyncService
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf'>
  refresh: { refreshAutomatic: (input: BlsAutomaticRefreshInput) => Promise<{ state: 'updated' | 'unchanged' | 'unavailable' }> }
  now: () => string
}>

export function createBlsScheduleAndLatestValuesSyncWorkflow(deps: Dependencies): BlsScheduleAndValuesSyncWorkflow {
  return Object.freeze({
    async sync(input: unknown): Promise<BlsScheduleAndValuesResult> {
      if (!isYearInput(input)) return unavailable()
      let schedule: BlsEmploymentScheduleSyncResult
      if (!deps.schedule) return unavailable()
      try { schedule = await deps.schedule.sync(input) } catch { return unavailable() }
      if (schedule.state !== 'completed') return unavailable()
      let workflowAsOf: string
      try { workflowAsOf = deps.now() } catch { return completed(schedule.schedule, { cpi: 'unavailable', employment: 'unavailable' }) }
      if (!isCanonicalUtcMillis(workflowAsOf)) return completed(schedule.schedule, { cpi: 'unavailable', employment: 'unavailable' })
      if (workflowAsOf.slice(0, 4) !== input.year) return completed(schedule.schedule, { cpi: 'not-required', employment: 'not-required' })
      const today = workflowAsOf.slice(0, 10)
      const candidates = selectCandidates(schedule.groups, today)
      const values = await Promise.all(blsScheduleTriggeredCatchUpPolicy.familyOrder.map((family) => resolveFamily(family, candidates[family], workflowAsOf, deps)))
      return completed(schedule.schedule, { cpi: values[0]!, employment: values[1]! })
    }
  })
}

async function resolveFamily(
  family: 'cpi' | 'employment',
  candidate: BlsScheduleGroupDescriptor | undefined,
  workflowAsOf: string,
  deps: Dependencies
): Promise<'updated' | 'current' | 'not-required' | 'unavailable'> {
  if (!candidate) return 'not-required'
  try {
    const result = await deps.refresh.refreshAutomatic({ ...candidate, workflowAsOf, trigger: 'schedule-latest-catch-up' })
    return result.state === 'updated' ? 'updated' : result.state === 'unchanged' ? 'current' : 'unavailable'
  } catch { return 'unavailable' }
}

function selectCandidates(groups: readonly BlsScheduleGroupDescriptor[], today: string): Record<'cpi' | 'employment', BlsScheduleGroupDescriptor | undefined> {
  const selected = { cpi: undefined as BlsScheduleGroupDescriptor | undefined, employment: undefined as BlsScheduleGroupDescriptor | undefined }
  for (const family of blsScheduleTriggeredCatchUpPolicy.familyOrder) {
    selected[family] = groups.filter((group) => group.family === family && group.scheduledDate < today).sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate))[0]
  }
  return selected
}

function isYearInput(value: unknown): value is { year: `${number}` } {
  return Boolean(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 1 && typeof (value as { year?: unknown }).year === 'string' && /^\d{4}$/.test((value as { year: string }).year))
}
function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function completed(schedule: 'updated' | 'unchanged', values: { cpi: 'updated' | 'current' | 'not-required' | 'unavailable'; employment: 'updated' | 'current' | 'not-required' | 'unavailable' }): BlsScheduleAndValuesResult {
  return Object.freeze({ state: 'completed' as const, schedule, values: Object.freeze(values) })
}
function unavailable(): BlsScheduleAndValuesResult { return Object.freeze({ state: 'unavailable' }) }
