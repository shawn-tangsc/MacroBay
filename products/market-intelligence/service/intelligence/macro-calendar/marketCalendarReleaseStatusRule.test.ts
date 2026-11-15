import { describe, expect, it } from 'vitest'

import { deriveReleaseStatus } from './marketCalendarReleaseStatusRule'

const at = (iso: string): number => Date.parse(iso)
const base = {
  scheduledDate: '2026-11-10', today: '2026-11-16', hasActual: false, attempts: 0,
  nowMs: at('2026-11-16T00:30:00.000Z'), releaseAtMs: at('2026-11-10T13:30:00.000Z')
}

describe('发布后状态规则（五态 + 24h 窗口）', () => {
  it('过期无值且窗口内 → backfilling（读者看到「待补值」）', () => {
    expect(deriveReleaseStatus({ ...base, nowMs: at('2026-11-10T20:00:00.000Z') })).toBe('backfilling')
  })

  it('过期无值且超过 24 小时 → missing，**绝不返回 scheduled**（今天那个 bug）', () => {
    const status = deriveReleaseStatus({ ...base })
    expect(status).toBe('missing')
    expect(status).not.toBe('scheduled')
  })

  it('有实际值 → published，不管日期（早到也算）', () => {
    expect(deriveReleaseStatus({ ...base, hasActual: true, scheduledDate: '2026-12-10' })).toBe('published')
  })

  it('还没到发布日 → scheduled（唯一允许「待发布」的情况）', () => {
    expect(deriveReleaseStatus({ ...base, scheduledDate: '2026-12-10', releaseAtMs: at('2026-12-10T13:30:00.000Z') })).toBe('scheduled')
  })

  it('源明确取消 → cancelled，不看日期与值', () => {
    expect(deriveReleaseStatus({ ...base, sourceStatus: 'cancelled', hasActual: true })).toBe('cancelled')
  })

  it('源说 unknown（来源没给状态）→ 过期无值时归 missing，不单开第六态', () => {
    expect(deriveReleaseStatus({ ...base, sourceStatus: 'unknown' })).toBe('missing')
  })

  it('尝试次数用尽 → missing，即使还在 24 小时窗口内', () => {
    expect(deriveReleaseStatus({ ...base, nowMs: at('2026-11-10T16:00:00.000Z'), attempts: 5 })).toBe('missing')
  })
})
