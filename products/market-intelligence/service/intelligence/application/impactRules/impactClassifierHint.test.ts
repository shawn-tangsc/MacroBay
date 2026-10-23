import { describe, expect, it } from 'vitest'

import {
  resolveExchangeAnnouncementAction,
  resolveFedPolicyTone,
  resolveRegulatorDirection
} from './impactClassifierHint'

describe('impactClassifierHint', () => {
  it('prefers classifier impact hints over generic headlines for Fed tone', () => {
    const tone = resolveFedPolicyTone({
      title: 'Federal Reserve Press Release',
      summary: 'Read the full statement.',
      processingLabelsJson: JSON.stringify({
        sentimentEligible: true,
        impactHintJson: JSON.stringify({ direction: 'bearish', reasonCode: 'hawkish' })
      })
    })
    expect(tone).toBe('hawkish')
  })

  it('prefers regulator eventSubtype over generic headlines', () => {
    const direction = resolveRegulatorDirection({
      title: 'SEC Press Release',
      processingLabelsJson: JSON.stringify({
        relevanceOutcome: 'full-intelligence',
        sentimentEligible: true,
        eventSubtype: 'regulator-enforcement',
        impactHintJson: JSON.stringify({ direction: 'bearish', reasonCode: 'regulator-enforcement' })
      })
    })
    expect(direction).toBe('bearish')
  })

  it('prefers exchange eventSubtype over generic headlines', () => {
    const action = resolveExchangeAnnouncementAction({
      title: 'Binance Announcement',
      processingLabelsJson: JSON.stringify({
        relevanceOutcome: 'full-intelligence',
        eventSubtype: 'exchange-listing',
        impactHintJson: JSON.stringify({ direction: 'bullish', reasonCode: 'exchange-listing' })
      })
    })
    expect(action).toBe('listing')
  })
})
