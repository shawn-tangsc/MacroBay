import { describe, expect, it } from 'vitest'
import { checkDailyBriefWebEvidence, createWebSearchBudget, type DailyBriefWebEvidenceRef } from './dailyBriefWebEvidence'

const ref = (overrides: Partial<DailyBriefWebEvidenceRef> = {}): DailyBriefWebEvidenceRef => ({
  evidenceRefId: 'web:US.NFP:consensus:1', eventKey: 'US.NFP', field: 'consensus', value: '150K',
  sourceName: 'BLS', sourceUrl: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  publishedAt: '2026-11-06T12:30:00.000Z', retrievedAt: '2026-11-06T12:31:00.000Z', ...overrides
})

describe('daily brief web evidence', () => {
  it('accepts a sourced value inside the cutoff and rejects late or unsafe sources', () => {
    expect(checkDailyBriefWebEvidence(ref(), '2026-11-06T13:00:00.000Z')).toBe('ok')
    expect(checkDailyBriefWebEvidence(ref({ publishedAt: '2026-11-06T14:00:00.000Z' }), '2026-11-06T13:00:00.000Z')).toBe('after-cutoff')
    expect(checkDailyBriefWebEvidence(ref({ sourceUrl: 'http://example.com' }), '2026-11-06T13:00:00.000Z')).toBe('invalid-url')
    expect(checkDailyBriefWebEvidence(ref({ sourceName: '' }), '2026-11-06T13:00:00.000Z')).toBe('missing-source')
  })

  it('stops at 3 events and 6 searches', () => {
    const budget = createWebSearchBudget()
    for (let index = 0; index < 3; index++) {
      expect(budget.canSearch(`E${index}`)).toBe(true)
      budget.record(`E${index}`)
      budget.record(`E${index}`)
    }
    expect(budget.state).toEqual({ events: 3, searches: 6 })
    expect(budget.canSearch('E3')).toBe(false)
  })
})
