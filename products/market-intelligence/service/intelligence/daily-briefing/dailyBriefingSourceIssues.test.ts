import { describe, expect, it } from 'vitest'

import type { RuntimeStateRecord } from '@platform/jobs'
import { readNewsSourceIssues } from './dailyBriefingSourceIssues'

/**
 * 源静默/连续失败怎么进日报（`02` v2.167）：判定复用通知那条（同一窗口、同一门槛），
 * 只做两件事——挑出"今天有问题的新闻源"，以及**说得出最后一条新条目时刻**的静默。
 */

const NOW = '2026-11-07T12:00:00.000Z'
const at = (offsetHours: number): string => new Date(Date.parse(NOW) - offsetHours * 3_600_000).toISOString()

const state = (overrides: Partial<RuntimeStateRecord> & Readonly<{ resourceId: string }>): RuntimeStateRecord => ({
  owner: 'product',
  productId: 'market-intelligence',
  status: 'idle',
  consecutiveFailures: 0,
  updatedAt: NOW,
  ...overrides
})

describe('which news sources are reported to the reader', () => {
  it('reports a source that has brought nothing new for 25 hours, with the last new item time', () => {
    const issues = readNewsSourceIssues({
      states: [state({ resourceId: 'coindesk-rss', checkpoint: { lastPublishedAt: at(25) }, lastSuccessAt: at(0.25) })],
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ sourceId: 'coindesk-rss', name: 'CoinDesk RSS', state: 'silent', lastNewItemAt: at(25) })
    // 静默看的是"最后一次真的带来新条目"，不是"最后一次采集成功"（后者是 15 分钟前）。
    expect(issues[0]!.silentHours).toBe(25)
  })

  it('reports a source that keeps failing as a different state', () => {
    const issues = readNewsSourceIssues({
      states: [state({ resourceId: 'cryptopanic', consecutiveFailures: 3, lastFailureAt: at(0.5) })],
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ sourceId: 'cryptopanic', state: 'failed', consecutiveFailures: 3 })
    expect(issues[0]!.lastNewItemAt).toBeUndefined()
  })

  it('keeps a normal source out of the list entirely', () => {
    const issues = readNewsSourceIssues({
      states: [state({ resourceId: 'coindesk-rss', checkpoint: { lastPublishedAt: at(2) }, lastSuccessAt: at(2) })],
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })
    expect(issues).toEqual([])
  })

  it('ignores sources that are not news — the calendar has its own reason codes', () => {
    const issues = readNewsSourceIssues({
      states: [state({ resourceId: 'fed-fomc-calendar', checkpoint: { lastPublishedAt: at(40) }, consecutiveFailures: 4 })],
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })
    expect(issues).toEqual([])
  })

  it('says nothing about a quiet source when it cannot name the last new item', () => {
    // 只有"上次采集成功"、没有"最后一条新条目"：说得出小时数也说不出时刻，宁可不报。
    const issues = readNewsSourceIssues({
      states: [state({ resourceId: 'coindesk-rss', lastSuccessAt: at(30) })],
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })
    expect(issues).toEqual([])
  })

  it('reports one entry per source, even when the state table repeats a row', () => {
    const issues = readNewsSourceIssues({
      states: [
        state({ resourceId: 'coindesk-rss', checkpoint: { lastPublishedAt: at(25) } }),
        state({ resourceId: 'coindesk-rss', checkpoint: { lastPublishedAt: at(26) } })
      ],
      now: NOW,
      timeZone: 'Asia/Shanghai'
    })
    expect(issues).toHaveLength(1)
  })

  it('has no answer when the judgement clock is unreadable', () => {
    expect(readNewsSourceIssues({ states: [state({ resourceId: 'coindesk-rss', checkpoint: { lastPublishedAt: at(25) } })], now: 'not-a-time', timeZone: 'UTC' })).toEqual([])
  })
})
