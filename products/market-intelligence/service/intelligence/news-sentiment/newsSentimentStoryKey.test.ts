import { describe, expect, it } from 'vitest'

import type { NewsSentimentEntity } from '../schema/newsSentiment'
import { sharesStoryEvent, storyKeyOf, utcDayBucket } from './newsSentimentStoryKey'

const org = (name: string): NewsSentimentEntity => ({ name, kind: 'org' })
const event = (name: string): NewsSentimentEntity => ({ name, kind: 'event' })
const asset = (name: string): NewsSentimentEntity => ({ name, kind: 'asset' })

/** 11-04 那类真实形状：同一件事被写在不同标题里，共享事件词与机构词。 */
const electionDay = [
  { itemId: 'item-a', publishedAt: '2026-11-04T04:55:00.000Z', entities: [event('us midterm elections'), org('democrats'), asset('bitcoin')] },
  { itemId: 'item-b', publishedAt: '2026-11-04T10:38:00.000Z', entities: [event('us midterm elections'), org('democrats'), asset('bitcoin')] },
  { itemId: 'item-c', publishedAt: '2026-11-04T12:14:00.000Z', entities: [event('us midterm elections'), org('democrats'), asset('bitcoin')] }
]

describe('storyKeyOf', () => {
  it('anchors the key on the first report that got one, and later reports adopt it', () => {
    // 一轮评分按最新优先：较晚发布的那条先被评出来、先拿到键；较早那条随后并入它，
    // 而不是另起一个键——否则同一件事会有两个键。
    const firstScored = storyKeyOf({
      itemId: 'item-c',
      publishedAt: '2026-11-04T12:14:00.000Z',
      entities: electionDay[2]!.entities,
      peers: electionDay.slice(0, 2)
    })
    expect(firstScored).toBe('story:2026-11-04:item-c')

    const laterScored = storyKeyOf({
      itemId: 'item-a',
      publishedAt: '2026-11-04T04:55:00.000Z',
      entities: electionDay[0]!.entities,
      peers: [{ ...electionDay[1]!, storyKey: 'story:2026-11-04:item-c' }]
    })
    expect(laterScored).toBe('story:2026-11-04:item-c')
  })

  it('is order independent: shuffling the peers cannot change the key', () => {
    const peers = electionDay.slice(0, 2).map((peer) => ({ ...peer, storyKey: 'story:2026-11-04:item-a' }))
    const key = storyKeyOf({
      itemId: 'item-c',
      publishedAt: '2026-11-04T12:14:00.000Z',
      entities: electionDay[2]!.entities,
      peers: [peers[1]!, peers[0]!]
    })
    expect(key).toBe('story:2026-11-04:item-a')
  })

  it('is idempotent: the same input twice yields the same key', () => {
    const input = {
      itemId: 'item-b',
      publishedAt: '2026-11-04T10:38:00.000Z',
      entities: electionDay[1]!.entities,
      peers: electionDay
    }
    expect(storyKeyOf(input)).toBe(storyKeyOf(input))
  })

  it('does not merge two stories that only share coins', () => {
    const left = storyKeyOf({
      itemId: 'item-market',
      publishedAt: '2026-11-04T09:00:00.000Z',
      entities: [asset('bitcoin'), asset('ethereum')]
    })
    const right = storyKeyOf({
      itemId: 'item-other',
      publishedAt: '2026-11-04T09:05:00.000Z',
      entities: [asset('bitcoin'), asset('ethereum')],
      peers: [{ itemId: 'item-market', publishedAt: '2026-11-04T09:00:00.000Z', entities: [asset('bitcoin'), asset('ethereum')] }]
    })
    expect(left).toBe('story:2026-11-04:item-market')
    expect(right).toBe('story:2026-11-04:item-other')
    expect(sharesStoryEvent([asset('bitcoin'), asset('ethereum')], [asset('bitcoin'), asset('ethereum')])).toBe(false)
  })

  it('keeps two different exchange incidents apart even though both are "a hack"', () => {
    const mercado = [org('mercado bitcoin'), event('hack'), asset('bitcoin')]
    const binance = [org('binance'), event('hack'), asset('bitcoin')]
    const key = storyKeyOf({
      itemId: 'item-binance',
      publishedAt: '2026-11-03T06:00:00.000Z',
      entities: binance,
      peers: [{ itemId: 'item-mercado', publishedAt: '2026-11-03T05:00:00.000Z', entities: mercado }]
    })
    expect(key).toBe('story:2026-11-03:item-binance')
    expect(sharesStoryEvent(mercado, binance)).toBe(false)
  })

  it('returns no key when there are no entities, or when the date cannot be read', () => {
    expect(
      storyKeyOf({ itemId: 'item-a', publishedAt: '2026-11-04T04:55:00.000Z', entities: [] })
    ).toBeUndefined()
    expect(
      storyKeyOf({ itemId: 'item-a', publishedAt: 'not-a-date', entities: [org('binance'), event('hack')] })
    ).toBeUndefined()
  })

  it('merges within one UTC day and separates across the day boundary', () => {
    const entitySet = [org('binance'), event('hack')]
    expect(
      storyKeyOf({
        itemId: 'item-late',
        publishedAt: '2026-11-03T23:50:00.000Z',
        entities: entitySet,
        peers: [
          {
            itemId: 'item-early',
            publishedAt: '2026-11-03T00:10:00.000Z',
            entities: entitySet,
            storyKey: 'story:2026-11-03:item-early'
          }
        ]
      })
    ).toBe('story:2026-11-03:item-early')
    expect(
      storyKeyOf({
        itemId: 'item-next-day',
        publishedAt: '2026-11-04T00:10:00.000Z',
        entities: entitySet,
        peers: [{ itemId: 'item-early', publishedAt: '2026-11-03T00:10:00.000Z', entities: entitySet }]
      })
    ).toBe('story:2026-11-04:item-next-day')
  })

  it('rejects a peer with the same itemId so a re-score cannot become its own peer', () => {
    const entities = [org('binance'), event('hack')]
    expect(
      storyKeyOf({
        itemId: 'item-a',
        publishedAt: '2026-11-03T05:00:00.000Z',
        entities,
        peers: [{ itemId: 'item-a', publishedAt: '2026-11-03T05:00:00.000Z', entities }]
      })
    ).toBe('story:2026-11-03:item-a')
  })
})

describe('utcDayBucket', () => {
  it('reads the UTC date, not the local one', () => {
    expect(utcDayBucket('2026-11-03T23:50:00.000Z')).toBe('2026-11-03')
    expect(utcDayBucket('2026-11-04T00:10:00.000Z')).toBe('2026-11-04')
    expect(utcDayBucket('2026-11-04T00:10:00.000+08:00')).toBe('2026-11-03')
    expect(utcDayBucket('not-a-date')).toBeUndefined()
  })
})
