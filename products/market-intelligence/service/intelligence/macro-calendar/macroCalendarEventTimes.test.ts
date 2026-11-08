import { describe, expect, it } from 'vitest'

import type { MacroCalendarRevision } from './macroCalendarContracts'
import { createMacroCalendarRepository } from './macroCalendarRepository'

/**
 * 两个时刻的口径（R36，产品 2026-11-09 定）：
 *
 * - **创建时间** = 这条事件**第一次落库**的时刻，后续修订不改变它；
 * - **实际值时间** = 第一次拿到非空现值那一刻的**来源观测时刻**，不是发布时间、不是日历时刻、
 *   也不是本机刷新时刻。
 *
 * 夹具用真实形状：FOMC 那类事件先有 schedule 行（早 6 小时），发布值由一个更晚的
 * `official-release` 行带来，而那条的 `published_at` 又比观测时刻早一天。三者互不相等，
 * 所以「显示的是哪一个」不会靠巧合成立。
 */
const EVENT_KEY = 'US.FOMC.2026-10-28'

function revision(overrides: Partial<MacroCalendarRevision>): MacroCalendarRevision {
  return {
    revisionId: `revision-${overrides.detectedAt ?? 'x'}`,
    eventKey: EVENT_KEY,
    releaseGroupKey: EVENT_KEY,
    eventFamily: 'fomc',
    eventNameKey: 'fomc',
    countryCode: 'US',
    importance: 'high',
    periodKey: '2026-10',
    lifecycleState: 'scheduled',
    revisionKind: 'schedule',
    scheduledDate: '2026-10-28',
    detectedAt: '2026-10-30T08:35:28.000Z',
    recordedAt: '2026-10-30T08:35:28.000Z',
    providerId: 'macro-calendar-fed',
    descriptorId: 'fixture-fed-schedule',
    sourceUrl: 'https://official.invalid/fomc',
    evidenceHash: `evidence-${overrides.revisionId ?? '1'}`,
    evidenceRefs: [{
      providerId: 'macro-calendar-fed', descriptorId: 'fixture-fed-schedule', sourceUrl: 'https://official.invalid/fomc',
      evidenceHash: `evidence-${overrides.revisionId ?? '1'}`, detectedAt: '2026-10-30T08:35:28.000Z', fieldKinds: ['schedule']
    }],
    snapshotHash: `snapshot-${overrides.revisionId ?? '1'}`,
    parserVersion: 'fixture-v1',
    caveats: [],
    ...overrides
  }
}

function repositoryWithHistory() {
  const repository = createMacroCalendarRepository({ filePath: ':memory:' })
  repository.appendIfNew(revision({ revisionId: 'schedule', detectedAt: '2026-10-30T08:35:28.000Z', recordedAt: '2026-10-30T08:35:28.000Z' }))
  repository.appendIfNew(revision({
    revisionId: 'release',
    lifecycleState: 'released',
    revisionKind: 'official-release',
    // 来源观测时刻比发布时刻晚一天多：显示哪一个不会靠巧合。
    publishedAt: '2026-10-28T18:00:00.000Z',
    detectedAt: '2026-10-30T14:40:21.000Z',
    recordedAt: '2026-10-30T14:40:21.000Z',
    actual: { displayValue: '3.75%–4.00%', numericValue: 3.875, unit: 'percent' }
  }))
  return repository
}

describe('event record times', () => {
  it('reports when the event first landed, not when its latest revision landed', () => {
    const repository = repositoryWithHistory()
    try {
      // 第三条修订更晚：创建时间必须还是最早那条。
      repository.appendIfNew(revision({
        revisionId: 'revision',
        lifecycleState: 'released',
        revisionKind: 'official-revision',
        detectedAt: '2026-10-31T09:00:00.000Z',
        recordedAt: '2026-10-31T09:00:00.000Z',
        actual: { displayValue: '3.75%–4.00%', numericValue: 3.875, unit: 'percent' }
      }))
      expect(repository.getEventTimesAsOf({ eventKey: EVENT_KEY, asOf: '2026-11-01T00:00:00.000Z' })).toEqual({
        createdAt: '2026-10-30T08:35:28.000Z',
        actualDetectedAt: '2026-10-30T14:40:21.000Z'
      })
    } finally { repository.close() }
  })

  it('reports the source observation instant that first carried the value, not the publication time', () => {
    const repository = repositoryWithHistory()
    try {
      const times = repository.getEventTimesAsOf({ eventKey: EVENT_KEY, asOf: '2026-11-01T00:00:00.000Z' })
      expect(times?.actualDetectedAt).toBe('2026-10-30T14:40:21.000Z')
      // 发布时刻比观测时刻早一天多——这正是「不许拿发布时刻顶上」的那条判据。
      expect(times?.actualDetectedAt).not.toBe('2026-10-28T18:00:00.000Z')
    } finally { repository.close() }
  })

  /**
   * BLS/BEA/0xRouter 走的是"删旧行再插入"。如果从修订表聚合 `min(recorded_at)`，拿到的会是
   * **这次替换的写入时刻**——所以这条用例必须用替换式来源，并且断言"重新读一次还是第一次"。
   * 反证：把实现改回 `min(recorded_at)`，下面的 createdAt 会变成 T2 而不是 T1。
   */
  it('keeps the first time across a replacement of the whole row', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      const bls = (overrides: Partial<MacroCalendarRevision>): MacroCalendarRevision => revision({
        eventFamily: 'consumer-price-index',
        eventNameKey: 'cpi',
        providerId: 'macro-calendar-bls',
        descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2',
        caveats: ['bls-python-schedule'],
        ...overrides
      })
      repository.appendIfNew(bls({
        revisionId: 'first', lifecycleState: 'released', revisionKind: 'official-release',
        detectedAt: '2026-10-20T12:30:00.000Z', recordedAt: '2026-10-20T12:30:00.000Z',
        actual: { displayValue: '3.0%', numericValue: 3, unit: 'percent' }
      }))
      // 同一条事件被整体替换：修订表里第一行已经不在了。
      repository.appendIfNew(bls({
        revisionId: 'second', lifecycleState: 'released', revisionKind: 'official-release',
        detectedAt: '2026-10-21T12:30:00.000Z', recordedAt: '2026-10-21T12:30:00.000Z',
        actual: { displayValue: '3.2%', numericValue: 3.2, unit: 'percent' }
      }))

      // 表里确实只剩替换后的那一行（这就是"不能聚合"的原因）。
      expect(repository.getEffectiveEventAsOf({ eventKey: EVENT_KEY, asOf: '2026-11-01T00:00:00.000Z' })?.recordedAt)
        .toBe('2026-10-21T12:30:00.000Z')
      expect(repository.getEventTimesAsOf({ eventKey: EVENT_KEY, asOf: '2026-11-01T00:00:00.000Z' })).toEqual({
        createdAt: '2026-10-20T12:30:00.000Z',
        actualDetectedAt: '2026-10-20T12:30:00.000Z'
      })
    } finally { repository.close() }
  })

  it('hides times that were not visible yet at the as-of instant', () => {
    const repository = repositoryWithHistory()
    try {
      expect(repository.getEventTimesAsOf({ eventKey: EVENT_KEY, asOf: '2026-10-30T09:00:00.000Z' })).toEqual({
        createdAt: '2026-10-30T08:35:28.000Z'
      })
    } finally { repository.close() }
  })
})
