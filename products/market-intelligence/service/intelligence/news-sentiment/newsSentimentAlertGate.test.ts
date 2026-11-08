import { describe, expect, it } from 'vitest'

import { decideAlert, selectBaselineCandidates } from './newsSentimentAlertGate'

const NOW = '2026-11-06T22:00:00.000Z'
/** 默认「早就开着」，这样新鲜条目能过闸；开启那一刻的边界由下面的探针单独构造。 */
const ENABLED = '2026-11-05T00:00:00.000Z'

function judgement(overrides: Partial<Parameters<typeof decideAlert>[0]> = {}) {
  return {
    engine: 'model' as const,
    strength: 3,
    // 默认门槛「中」＝今天的推送行为。
    threshold: 'medium' as const,
    storyKey: 'story:2026-11-06:item-a',
    // 开启前半小时发布 —— 三年后来看这条用例名也知道它防的是「补历史」。
    publishedAt: '2026-11-06T21:30:00.000Z',
    enabledAt: ENABLED,
    now: NOW,
    alreadyPushed: false,
    ...overrides
  }
}

describe('decideAlert', () => {
  it('pushes a fresh model judgement at medium or above that has a story key', () => {
    expect(decideAlert(judgement())).toEqual({ push: true, tier: 'medium' })
    expect(decideAlert(judgement({ strength: 5 }))).toEqual({ push: true, tier: 'high' })
  })

  it('never pushes a keyword rule hit, whatever its strength', () => {
    expect(decideAlert(judgement({ engine: 'rules', strength: 5 }))).toEqual({
      push: false,
      reason: 'rules-engine'
    })
  })

  it('never pushes below the configured threshold, and never pushes without a story key', () => {
    expect(decideAlert(judgement({ strength: 2 }))).toEqual({ push: false, reason: 'below-threshold' })

    // 门槛可配之后按档位比：同一条记录换门槛，结论必须跟着变（四条两两成对）。
    expect(decideAlert(judgement({ strength: 3, threshold: 'medium' }))).toEqual({ push: true, tier: 'medium' })
    expect(decideAlert(judgement({ strength: 3, threshold: 'high' }))).toEqual({ push: false, reason: 'below-threshold' })
    expect(decideAlert(judgement({ strength: 2, threshold: 'low' }))).toEqual({ push: true, tier: 'low' })
    expect(decideAlert(judgement({ strength: 2, threshold: 'medium' }))).toEqual({ push: false, reason: 'below-threshold' })
    expect(decideAlert(judgement({ storyKey: undefined }))).toEqual({ push: false, reason: 'no-story-key' })
    expect(decideAlert(judgement({ storyKey: '  ' }))).toEqual({ push: false, reason: 'no-story-key' })
  })

  it('blocks what was published before the reader enabled push, even if it looked fresh afterwards', () => {
    // 21:30 发布 / 22:00 开启 / 22:05 因重建被重评（`scoredAt` 落在基线之后）。
    // 判据只看 publishedAt —— 换成「什么时候被判出来的」这条就会过。
    expect(
      decideAlert(
        judgement({
          publishedAt: '2026-11-06T21:30:00.000Z',
          enabledAt: '2026-11-06T22:00:00.000Z',
          now: '2026-11-06T22:05:00.000Z'
        })
      )
    ).toEqual({ push: false, reason: 'before-enable' })
  })

  it('keeps the 24 hour window on publishedAt: 23:59 pushes, 24:01 does not', () => {
    const enabledLongAgo = '2026-11-01T00:00:00.000Z'
    expect(
      decideAlert(judgement({ publishedAt: '2026-11-05T22:01:00.000Z', enabledAt: enabledLongAgo }))
    ).toEqual({ push: true, tier: 'medium' })
    expect(
      decideAlert(judgement({ publishedAt: '2026-11-05T21:59:00.000Z', enabledAt: enabledLongAgo }))
    ).toEqual({ push: false, reason: 'stale' })
  })

  it('pushes a three hour old item that was scored by rules first and by the model later', () => {
    // 这条是「防把闸判严」：规则先落不推、模型恢复后升档该推一次。
    expect(
      decideAlert(
        judgement({ engine: 'model', publishedAt: '2026-11-06T19:00:00.000Z', alreadyPushed: false })
      )
    ).toEqual({ push: true, tier: 'medium' })
    // 与上一条成对：同一条若发布在开启之前，仍然不推——升档不是补历史的理由。
    expect(
      decideAlert(
        judgement({
          engine: 'model',
          publishedAt: '2026-11-06T19:00:00.000Z',
          enabledAt: '2026-11-06T22:00:00.000Z'
        })
      )
    ).toEqual({ push: false, reason: 'before-enable' })
  })

  it('never pushes an item the ledger already holds, however often it is rescored', () => {
    expect(decideAlert(judgement({ alreadyPushed: true }))).toEqual({
      push: false,
      reason: 'already-pushed'
    })
  })

  it('refuses to guess when a timestamp cannot be read', () => {
    expect(decideAlert(judgement({ publishedAt: 'not-a-date' }))).toEqual({ push: false, reason: 'stale' })
    expect(decideAlert(judgement({ enabledAt: undefined }))).toEqual({ push: false, reason: 'stale' })
  })
})

describe('selectBaselineCandidates', () => {
  it('takes everything older than 24 hours as the baseline, and nothing younger', () => {
    const items = [
      { itemId: 'old-a', publishedAt: '2026-11-04T10:00:00.000Z' },
      { itemId: 'old-b', publishedAt: '2026-11-05T21:00:00.000Z' },
      { itemId: 'fresh', publishedAt: '2026-11-06T21:00:00.000Z' },
      { itemId: 'broken', publishedAt: 'not-a-date' }
    ]
    expect(selectBaselineCandidates(items, { now: NOW })).toEqual(['old-a', 'old-b'])
  })
})
