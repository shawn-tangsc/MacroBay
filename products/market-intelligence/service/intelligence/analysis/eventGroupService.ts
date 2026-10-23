import type { AnalysisDomain, EventGroup, EventGroupType } from '../../../contracts/marketAnalysisContracts'

export const eventGroupPolicy = Object.freeze({
  version: 'cryptoMarketAnalysisTriggerPolicy.v1',
  mergeWindowMs: 20 * 60 * 1_000,
  reviewWindowMs: 120 * 60 * 1_000
})

export type AnalysisChange = Readonly<{
  changeId: string
  domain: AnalysisDomain
  eventRef: string
  subject: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  changedFields: readonly string[]
  previousHash: string | null
  nextHash: string
  observedAt: string
  publishedAt: string | null
  confirmed: boolean
  sourceCount: number
  marketMove15mPct: number | null
  fundingDeltaPctPoints: number | null
  sourceKind: 'official' | 'proxy'
  comparability?: 'comparable' | 'proxy' | 'not-comparable'
  groupType: EventGroupType
  countryCode?: string
  periodKey?: string
  macroFamily?: string
}>

export type EventGroupService = Readonly<{
  shouldMerge: (group: EventGroup, change: AnalysisChange) => boolean
  create: (change: AnalysisChange, id?: string) => EventGroup
  addChange: (group: EventGroup | undefined, change: AnalysisChange) =>
    | { kind: 'new'; group: EventGroup; previousGroupId: null }
    | { kind: 'merged'; group: EventGroup; previousGroupId: null }
    | { kind: 'successor'; group: EventGroup; previousGroupId: string }
}>

export function eventGroupMergeKey(change: AnalysisChange): string {
  const sourceKind = change.sourceKind
  if (change.groupType === 'macro') {
    return [
      'macro',
      sourceKind,
      change.countryCode ?? 'unknown',
      change.periodKey ?? 'unknown',
      change.macroFamily ?? change.subject,
      releaseBucket(change.publishedAt ?? change.observedAt)
    ].join('|')
  }
  return [change.groupType, sourceKind, change.domain, change.subject, releaseBucket(change.observedAt)].join('|')
}

export function createEventGroupService(deps: Readonly<{
  now: () => string
  idFactory: () => string
}>): EventGroupService {
  const shouldMerge = (group: EventGroup, change: AnalysisChange): boolean => {
    if (group.status === 'closed' || group.status === 'superseded') return false
    if (stableMergeKey(group.mergeKey) !== stableMergeKey(eventGroupMergeKey(change))) return false
    const observedAt = Date.parse(change.observedAt)
    const lastObservedAt = Date.parse(group.lastObservedAt)
    return Number.isFinite(observedAt) && Number.isFinite(lastObservedAt) && observedAt >= lastObservedAt && observedAt - lastObservedAt <= eventGroupPolicy.mergeWindowMs
  }

  const create = (change: AnalysisChange, id = deps.idFactory()): EventGroup => {
    const createdAt = deps.now()
    const firstObservedAt = change.observedAt
    return {
      id, schemaVersion: 1, status: 'open', groupType: change.groupType,
      mergeKey: eventGroupMergeKey(change), firstObservedAt, lastObservedAt: firstObservedAt,
      reviewDeadlineAt: new Date(Date.parse(firstObservedAt) + eventGroupPolicy.reviewWindowMs).toISOString(),
      eventRefs: [change.eventRef], triggerCount: 0, reviewCount: 0, currentSummaryId: null,
      supersededByGroupId: null, revision: 1, createdAt, updatedAt: createdAt
    }
  }

  const addChange = (group: EventGroup | undefined, change: AnalysisChange):
    | { kind: 'new'; group: EventGroup; previousGroupId: null }
    | { kind: 'merged'; group: EventGroup; previousGroupId: null }
    | { kind: 'successor'; group: EventGroup; previousGroupId: string } => {
    if (!group) return { kind: 'new', group: create(change), previousGroupId: null }
    if (group.status === 'closed' || group.status === 'superseded') {
      const successor = create(change)
      return group.status === 'closed'
        ? { kind: 'successor', group: successor, previousGroupId: group.id }
        : { kind: 'new', group: successor, previousGroupId: null }
    }
    if (!shouldMerge(group, change)) {
      return { kind: 'new', group: create(change), previousGroupId: null }
    }
    const updatedAt = deps.now()
    return {
      kind: 'merged', previousGroupId: null,
      group: {
        ...group, status: group.status === 'open' ? 'open' : 'monitoring',
        lastObservedAt: change.observedAt,
        eventRefs: [...new Set([...group.eventRefs, change.eventRef])],
        revision: group.revision + 1, updatedAt
      }
    }
  }

  return { shouldMerge, create, addChange }
}

function releaseBucket(timestamp: string): string {
  const milliseconds = Date.parse(timestamp)
  return Number.isFinite(milliseconds)
    ? String(Math.floor(milliseconds / eventGroupPolicy.mergeWindowMs))
    : 'invalid'
}

function stableMergeKey(value: string): string {
  const parts = value.split('|')
  return parts.slice(0, -1).join('|')
}
