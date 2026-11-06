import { describe, expect, it } from 'vitest'

import { buildSentimentAlertContent } from './newsSentimentAlertRequest'

const BASE = {
  storyKey: 'story:2026-11-06:item-a',
  strength: 'high' as const,
  headline: 'Democrats surge in midterm polls',
  sourceName: 'CoinDesk',
  publishedAt: '2026-11-06T21:30:00.000Z'
}

describe('buildSentimentAlertContent', () => {
  it('renders the three blocks in both languages, with the bracket style each language uses', () => {
    const content = buildSentimentAlertContent(BASE)!
    expect(content.rendered['zh-CN']).toEqual({
      title: '【高】Democrats surge in midterm polls',
      body: '来源：CoinDesk',
      reason: '分析给出的强度达到了收推送的门槛。'
    })
    expect(content.rendered['en-US']).toEqual({
      title: '[High] Democrats surge in midterm polls',
      body: 'Source: CoinDesk',
      reason: 'The analysis rated this high enough to reach your phone.'
    })
  })

  it('keeps the link out of every sentence so the centre row cannot be truncated', () => {
    const content = buildSentimentAlertContent(BASE)!
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const sentences = content.rendered[locale]!
      expect(`${sentences.title}${sentences.body}${sentences.reason}`).not.toContain('http')
    }
  })

  it('does not submit without a source name: an empty segment would be rejected as copy-missing', () => {
    expect(buildSentimentAlertContent({ ...BASE, sourceName: undefined })).toBeUndefined()
    expect(buildSentimentAlertContent({ ...BASE, sourceName: '   ' })).toBeUndefined()
  })

  it('builds one dedupe key per story so repeats merge instead of pushing twice', () => {
    const content = buildSentimentAlertContent(BASE)!
    expect(content.dedupeVars).toEqual({ builder: 'template', vars: { storyKey: BASE.storyKey } })
    expect(content.eventTypeId).toBe('market-intelligence.sentiment.alert')
    expect(content.occurredAt).toBe(BASE.publishedAt)
  })

  it('treats a missing headline or story key as "do not submit"', () => {
    expect(buildSentimentAlertContent({ ...BASE, headline: ' ' })).toBeUndefined()
    expect(buildSentimentAlertContent({ ...BASE, storyKey: ' ' })).toBeUndefined()
  })
})
