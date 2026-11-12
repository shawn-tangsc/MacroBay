import { describe, expect, it } from 'vitest'

import {
  compareNormalized, inferPeriodFromReleaseAt, normalizeUnit, pickCurrentRelease
} from './narwhalCalendarNormalization'

describe('unit and sign normalisation', () => {
  it('converts 万 to 千 so the two sources meet at the same number', () => {
    // 实测那一对：旧源 752.3 万人 / 新源 7523 千人。
    expect(normalizeUnit('7523', '千人')).toEqual({ value: 7523, unit: '千人' })
    expect(normalizeUnit('752.3', '万人')).toEqual({ value: 7523, unit: '千人', conversion: '万人 ×10 → 千人' })
  })

  it('converts 十亿美元 to dollars for the deficit figure', () => {
    const converted = normalizeUnit('404063547877.59', '美元')
    const legacy = normalizeUnit('404.0', '十亿美元', '财政赤字')
    expect(converted.value).toBe(404063547877.59)
    expect(legacy.value).toBeCloseTo(-404_000_000_000, 0)
    expect(legacy.conversion).toContain('十亿美元 ×1000000000 → 美元')
    expect(legacy.conversion).toContain('赤字/逆差记负')
  })

  it('keeps a dash as "no value" instead of turning it into 0', () => {
    expect(normalizeUnit('-', '千人').value).toBeUndefined()
  })
})

describe('value agreement thresholds', () => {
  it('treats a difference within half a display unit as equal, one to two as reviewable, beyond as conflict', () => {
    expect(compareNormalized(3.72, 3.74, 1)).toBe('equal')     // 显示 3.7% both
    expect(compareNormalized(3.72, 3.80, 1)).toBe('within-display')
    expect(compareNormalized(27.84, 6.4, 2)).toBe('conflict')
  })
})

describe('period inference', () => {
  it('reads a November 6 release as October data', () => {
    expect(inferPeriodFromReleaseAt('2026-11-06T13:30:00Z')).toBe('2026-10')
  })
})

describe('current release pick', () => {
  it('prefers the exact instant, then consensus, then the larger revision', () => {
    const picked = pickCurrentRelease([
      { releaseId: 'b-indicative', at: '2026-11-10T13:30:00Z', dateBasis: 'indicative', hasConsensus: true, revision: 9 },
      { releaseId: 'a-exact', at: '2026-11-06T13:30:00Z', dateBasis: 'exact', hasConsensus: false, revision: 1 }
    ])
    expect(picked?.releaseId).toBe('a-exact')
  })

  it('keeps the row that carries consensus when both are exact — that is the reason we switched source', () => {
    const picked = pickCurrentRelease([
      { releaseId: 'no-consensus', at: '2026-11-06T13:30:00Z', dateBasis: 'exact', hasConsensus: false, revision: 3 },
      { releaseId: 'with-consensus', at: '2026-11-06T13:30:00Z', dateBasis: 'exact', hasConsensus: true, revision: 1 }
    ])
    expect(picked?.releaseId).toBe('with-consensus')
  })
})
