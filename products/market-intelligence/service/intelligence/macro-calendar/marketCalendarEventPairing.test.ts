import { describe, expect, it } from 'vitest'

import { eventPairVerdict } from './marketCalendarEventPairing'

const speech = '2026-11-13T18:00:00.000Z'

describe('事件型配对：同一件事只出一行', () => {
  it('同一场讲话两源都有（差 30 分钟）→ 旧行让位，只出 Narwhal 那行', () => {
    expect(eventPairVerdict({
      scheduledAt: '2026-11-13T18:30:00.000Z', narwhalInstants: [speech], dateLevelCandidateCount: 0
    })).toBe('covered-by-narwhal')
    // 同一条用例里钉住窗口本身：把 60 分钟放大到小时级，这一行就会变成「两件事」→ 必红。
    expect(eventPairVerdict({
      scheduledAt: '2026-11-14T13:00:00.000Z', narwhalInstants: [speech], dateLevelCandidateCount: 0
    })).toBe('keep-old')
  })

  it('差 90 分钟就是两件事，旧行保留', () => {
    expect(eventPairVerdict({
      scheduledAt: '2026-11-13T19:30:00.000Z', narwhalInstants: [speech], dateLevelCandidateCount: 0
    })).toBe('keep-old')
  })

  it('旧源只有日期、当天同类型三条候选 → 不合并，两条都出并计数', () => {
    expect(eventPairVerdict({
      scheduledAt: '2026-11-13T00:00:00.000Z', narwhalInstants: [speech], dateLevelCandidateCount: 3
    })).toBe('ambiguous-day')
  })

  it('旧源只有日期、当天只有它一条 → 可以配', () => {
    expect(eventPairVerdict({
      scheduledAt: '2026-11-13T00:00:00.000Z', narwhalInstants: [speech], dateLevelCandidateCount: 1
    })).toBe('covered-by-narwhal')
  })

  it('当天没有新源的场次 → 旧行照常出', () => {
    expect(eventPairVerdict({
      scheduledAt: '2026-11-13T00:00:00.000Z', narwhalInstants: ['2026-11-10T18:00:00.000Z'],
      dateLevelCandidateCount: 1
    })).toBe('keep-old')
    expect(eventPairVerdict({ scheduledAt: speech, narwhalInstants: [], dateLevelCandidateCount: 0 }))
      .toBe('keep-old')
  })
})
