import { describe, expect, it } from 'vitest'

import { classifyRegulatorRelevance } from './regulatorRelevanceClassifier'

describe('regulatorRelevanceClassifier', () => {
  it('classifies crypto enforcement as full intelligence', () => {
    const result = classifyRegulatorRelevance({
      sourceId: 'sec-rss',
      title: 'SEC charges crypto exchange with fraud violations'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.eventSubtype).toBe('regulator-enforcement')
    expect(result.impactHint?.direction).toBe('bearish')
  })

  it('classifies ETF approval as positive full intelligence', () => {
    const result = classifyRegulatorRelevance({
      sourceId: 'sec-rss',
      title: 'SEC approves Bitcoin ETF application framework'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.eventSubtype).toBe('regulator-etf-approval')
    expect(result.impactHint?.direction).toBe('bullish')
  })

  it('ignores unrelated non-crypto enforcement', () => {
    const result = classifyRegulatorRelevance({
      sourceId: 'sec-rss',
      title: 'SEC charges insurance company with accounting fraud'
    })
    expect(result.outcome).toBe('ignore')
    expect(result.ignoredReasonCode).toBe('scope-not-matched')
  })

  it('returns context-only for low-confidence crypto mentions', () => {
    const result = classifyRegulatorRelevance({
      sourceId: 'cftc-rss',
      title: 'CFTC staff publishes digital asset reading list'
    })
    expect(result.outcome).toBe('context-only')
    expect(result.caveats).toContain('low-classifier-confidence')
  })
})
