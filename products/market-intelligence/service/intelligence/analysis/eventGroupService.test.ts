import { describe, expect, it } from 'vitest'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import {
  createEventGroupService,
  eventGroupMergeKey,
  type AnalysisChange
} from './eventGroupService'

const t0 = '2026-09-27T00:00:00.000Z'
const t20 = '2026-09-27T00:20:00.000Z'
const t20Plus = '2026-09-27T00:20:00.001Z'

function change(overrides: Partial<AnalysisChange> = {}): AnalysisChange {
  return {
    changeId: 'change-1', domain: 'macro', eventRef: 'event-1', subject: 'US CPI',
    severity: 'high', changedFields: ['actual'], previousHash: null, nextHash: 'hash-1',
    observedAt: t0, publishedAt: t0, confirmed: true, sourceCount: 1,
    marketMove15mPct: null, fundingDeltaPctPoints: null, sourceKind: 'official',
    groupType: 'macro', countryCode: 'US', periodKey: '2026-08', macroFamily: 'CPI',
    ...overrides
  }
}

function group(overrides: Partial<EventGroup> = {}): EventGroup {
  return {
    id: 'mi-eg-1', schemaVersion: 1, status: 'monitoring', groupType: 'macro',
    mergeKey: eventGroupMergeKey(change()), firstObservedAt: t0, lastObservedAt: t0,
    reviewDeadlineAt: '2026-09-27T00:30:00.000Z', eventRefs: ['event-1'], triggerCount: 1,
    reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1,
    createdAt: t0, updatedAt: t0, ...overrides
  }
}

describe('eventGroupService', () => {
  it('merges exactly at 20 minutes and starts a new group after the boundary', () => {
    const service = createEventGroupService({ now: () => t20, idFactory: () => 'mi-eg-2' })
    expect(service.shouldMerge(group(), change({ observedAt: t20, publishedAt: t20 }))).toBe(true)
    expect(service.shouldMerge(group(), change({ observedAt: t20Plus, publishedAt: t20Plus }))).toBe(false)
  })

  it('creates a distinct bucketed successor after the 20-minute boundary', () => {
    const service = createEventGroupService({ now: () => t20Plus, idFactory: () => 'mi-eg-2' })
    const result = service.addChange(group(), change({ observedAt: t20Plus, publishedAt: t20Plus }))
    expect(result.kind).toBe('new')
    expect(result.group.mergeKey).not.toBe(group().mergeKey)
  })

  it('does not merge official and proxy facts even when their subjects match', () => {
    expect(eventGroupMergeKey(change({ sourceKind: 'official' }))).not.toBe(eventGroupMergeKey(change({ sourceKind: 'proxy' })))
  })

  it('creates a successor instead of reopening a closed group', () => {
    const service = createEventGroupService({ now: () => t20Plus, idFactory: () => 'mi-eg-successor' })
    const result = service.addChange(group({ status: 'closed' }), change({ observedAt: t20Plus }))
    expect(result.kind).toBe('successor')
    expect(result.group.id).toBe('mi-eg-successor')
    expect(result.previousGroupId).toBe('mi-eg-1')
  })
})
