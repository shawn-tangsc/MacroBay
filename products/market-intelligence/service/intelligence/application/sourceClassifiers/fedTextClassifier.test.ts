import { describe, expect, it } from 'vitest'

import { classifyFedText } from './fedTextClassifier'

describe('fedTextClassifier', () => {
  it('classifies hawkish Fed messaging as full intelligence', () => {
    const result = classifyFedText({
      sourceId: 'federal-reserve-rss',
      title: 'FOMC signals further tightening as inflation remains elevated'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.impactHint?.reasonCode).toBe('hawkish')
    expect(result.sentimentEligible).toBe(true)
  })

  it('classifies dovish Fed messaging as full intelligence', () => {
    const result = classifyFedText({
      sourceId: 'federal-reserve-rss',
      title: 'Fed officials open to pause as disinflation continues'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.impactHint?.reasonCode).toBe('dovish')
  })

  it('classifies supervision items as context-only', () => {
    const result = classifyFedText({
      sourceId: 'federal-reserve-rss',
      title: 'Federal Reserve announces bank supervision examination schedule'
    })
    expect(result.outcome).toBe('context-only')
    expect(result.eventSubtype).toBe('fed-supervision')
    expect(result.sentimentEligible).toBe(false)
  })

  it('classifies operational items as context-only with low confidence', () => {
    const result = classifyFedText({
      sourceId: 'federal-reserve-rss',
      title: 'Federal Reserve holiday schedule office closed'
    })
    expect(result.outcome).toBe('context-only')
    expect(result.eventSubtype).toBe('fed-operational')
    expect(result.confidence).toBeLessThan(50)
  })
})
