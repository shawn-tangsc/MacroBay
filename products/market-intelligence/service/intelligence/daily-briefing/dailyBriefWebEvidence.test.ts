import { describe, expect, it } from 'vitest'
import { checkDailyBriefWebEvidence, createWebSearchBudget, isOfficialWebSource, type DailyBriefWebEvidenceRef } from './dailyBriefWebEvidence'

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

  it('rejects a fourth event', () => {
    const budget = createWebSearchBudget()
    for (const eventKey of ['E0', 'E1', 'E2']) expect(budget.request(eventKey, 'consensus')).toBe('search')
    expect(budget.request('E3', 'consensus')).toBe('denied')
    expect(budget.state).toEqual({ events: 3, searches: 3 })
  })

  it('rejects a seventh search', () => {
    const budget = createWebSearchBudget()
    for (const eventKey of ['E0', 'E1', 'E2']) {
      expect(budget.request(eventKey, 'consensus')).toBe('search')
      expect(budget.request(eventKey, 'reaction')).toBe('search')
    }
    expect(budget.state).toEqual({ events: 3, searches: 6 })
    expect(budget.request('E0', 'previous')).toBe('denied')
    expect(budget.state).toEqual({ events: 3, searches: 6 })
  })

  it('serves a repeated event field from the cache instead of searching again', () => {
    const budget = createWebSearchBudget()
    expect(budget.request('US.CPI', 'consensus')).toBe('search')
    expect(budget.request('US.CPI', 'consensus')).toBe('cached')
    expect(budget.request('US.CPI', 'reaction')).toBe('search')
    expect(budget.record('US.CPI', 'consensus')).toBe(false)
    expect(budget.state).toEqual({ events: 1, searches: 2 })
  })

  it('recognizes official statistical and central-bank hosts', () => {
    expect(isOfficialWebSource('https://www.bls.gov/cpi')).toBe(true)
    expect(isOfficialWebSource('https://www.federalreserve.gov/newsevents.htm')).toBe(true)
    expect(isOfficialWebSource('https://www.ecb.europa.eu/press/html/index.en.html')).toBe(true)
    expect(isOfficialWebSource('https://example.com/cpi')).toBe(false)
    expect(isOfficialWebSource('not a url')).toBe(false)
  })
})
