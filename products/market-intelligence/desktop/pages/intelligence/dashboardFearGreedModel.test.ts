import { describe, expect, it } from 'vitest'

import { FearGreedGaugePresentationPolicy, projectDashboardFearGreedSnapshot } from './dashboardFearGreedModel'

const asOf = '2026-08-06T12:00:00.000Z'

describe('projectDashboardFearGreedSnapshot', () => {
  it('projects only score, product bucket, and observed UTC time', () => {
    const result = projectDashboardFearGreedSnapshot({
      state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z'
    }, asOf)

    expect(result).toEqual({ state: 'available', score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z' })
    expect(JSON.stringify(result)).not.toMatch(/asOf|source|metric|https?:|credential|profile|health|error/i)
  })

  it.each([
    [{ state: 'empty', asOf }, { state: 'empty' }],
    [{ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, score: 101, bucket: 'extreme-greed', observedAt: asOf }, { state: 'unavailable' }],
    [{ state: 'available', asOf, score: 22, bucket: 'fear', observedAt: asOf }, { state: 'unavailable' }],
    [{ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T12:00:00.001Z' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: asOf, sourceUrl: 'https://secret.example.test' }, { state: 'unavailable' }]
  ])('returns the exact compact state for an untrusted result', (input, expected) => {
    expect(projectDashboardFearGreedSnapshot(input, asOf)).toEqual(expected)
  })

  it('fails closed without reading a secret-bearing accessor or proxy', () => {
    const accessor = { state: 'available', asOf, score: 22, bucket: 'extreme-fear', observedAt: asOf } as Record<string, unknown>
    Object.defineProperty(accessor, 'sourceUrl', { enumerable: true, get: () => 'https://secret.example.test' })
    const proxy = new Proxy({}, { ownKeys: () => { throw new Error('secret') } })

    expect(projectDashboardFearGreedSnapshot(accessor, asOf)).toEqual({ state: 'unavailable' })
    expect(projectDashboardFearGreedSnapshot(proxy, asOf)).toEqual({ state: 'unavailable' })
  })

  it.each([[0, -90], [22, -50.4], [50, 0], [75, 45], [100, 90]])('owns the 180-degree gauge position for score %s', (score, degrees) => {
    expect(FearGreedGaugePresentationPolicy.needleDegrees(score)).toBe(degrees)
  })

  it('gives the needle the mouth and the score the disc on the pivot', () => {
    expect(FearGreedGaugePresentationPolicy.svgViewBox).toBe('0 0 120 86')
    expect(FearGreedGaugePresentationPolicy.needleOrigin).toBe('60 60')
    expect(FearGreedGaugePresentationPolicy.needlePath).toBe('M 60 43 L 60 18')
    expect(FearGreedGaugePresentationPolicy.readout).toEqual({ cx: 60, cy: 60, radius: 19.5 })
    expect(FearGreedGaugePresentationPolicy.ticks.map((tick) => tick.score)).toEqual([0, 25, 50, 75, 100])
    // Five arc segments stay the source's five paths; the needle never re-draws the arc.
    expect(FearGreedGaugePresentationPolicy.arcSegments).toHaveLength(5)
    expect(FearGreedGaugePresentationPolicy.arcSegments.map((segment) => segment.tone)).toEqual([
      'extreme-fear', 'fear', 'neutral', 'greed', 'extreme-greed'
    ])
  })

  it('owns the fear-to-greed visual tones by the already-validated bucket', () => {
    expect(FearGreedGaugePresentationPolicy.bucketTones).toEqual({
      'extreme-fear': 'extreme-fear',
      fear: 'fear',
      neutral: 'neutral',
      greed: 'greed',
      'extreme-greed': 'extreme-greed'
    })
  })
})
