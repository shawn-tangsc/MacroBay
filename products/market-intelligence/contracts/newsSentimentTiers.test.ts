import { describe, expect, it } from 'vitest'

import { isAlertWorthy, tierOf } from './newsSentimentTiers'

describe('newsSentimentTiers', () => {
  it('maps the boundaries the card already shows: 2 low, 3 medium, 4 high', () => {
    expect([1, 2].map(tierOf)).toEqual(['low', 'low'])
    expect(tierOf(3)).toBe('medium')
    expect([4, 5].map(tierOf)).toEqual(['high', 'high'])
  })

  it('treats a non-finite strength as low instead of guessing a tier', () => {
    expect(tierOf(Number.NaN)).toBe('low')
    expect(tierOf(Number.POSITIVE_INFINITY)).toBe('low')
  })

  it('only calls a judgement alert-worthy when the model judged it, it is medium or above, and it has a story key', () => {
    expect(isAlertWorthy({ engine: 'model', strength: 3, storyKey: 'story:2026-11-04:item-a' })).toBe(true)
    expect(isAlertWorthy({ engine: 'model', strength: 4, storyKey: 'story:2026-11-04:item-a' })).toBe(true)
    // 同强度、同键，只差来源：规则命中的关键词表不算分析。
    expect(isAlertWorthy({ engine: 'rules', strength: 5, storyKey: 'story:2026-11-04:item-a' })).toBe(false)
    expect(isAlertWorthy({ engine: 'model', strength: 2, storyKey: 'story:2026-11-04:item-a' })).toBe(false)
    expect(isAlertWorthy({ engine: 'model', strength: 4, storyKey: '   ' })).toBe(false)
    expect(isAlertWorthy({ engine: 'model', strength: 4 })).toBe(false)
  })
})
