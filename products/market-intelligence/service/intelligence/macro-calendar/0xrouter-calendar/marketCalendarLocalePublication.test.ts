import { describe, expect, it } from 'vitest'

import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarSourceStatus } from './marketCalendarSourceStatus'
import { zeroXRouterCalendarPublishesLocale, zeroXRouterCalendarTransportPolicy } from '../../application/zeroXRouterSourcePolicy'

/**
 * 「来源没有这种语言」与「这个月没有事件」分开（2026-11-09，实测）：
 *
 * 证据归档里，`financial-events` / `central-bank-activities` 的 `locale=en` 请求返回的是同一份
 * 38 字节空载荷 `{"code":200,"msg":"success","data":[]}`，而同月 zh 分别是 14 / 73 行；
 * `economic-data` 同月 en 有 316 行。所以前两条**不发布英文**，自动采集不再请求 en，
 * 读者侧的空批次要标成 `no-locale-rows`，不是 `success-empty`。
 */
const ECONOMIC = 'macro-calendar-0xrouter-economic-data'
const FINANCIAL = 'macro-calendar-0xrouter-financial-events'
const CENTRAL = 'macro-calendar-0xrouter-central-bank-activities'

describe('which locales each calendar publishes', () => {
  it('is declared once for all three feeds', () => {
    expect(zeroXRouterCalendarTransportPolicy.publishedLocales).toEqual({
      [ECONOMIC]: ['zh', 'en'],
      [FINANCIAL]: ['zh'],
      [CENTRAL]: ['zh']
    })
  })

  it('answers per descriptor, and treats an unknown descriptor as published', () => {
    expect(zeroXRouterCalendarPublishesLocale(ECONOMIC, 'en')).toBe(true)
    expect(zeroXRouterCalendarPublishesLocale(FINANCIAL, 'en')).toBe(false)
    expect(zeroXRouterCalendarPublishesLocale(CENTRAL, 'en')).toBe(false)
    expect(zeroXRouterCalendarPublishesLocale(FINANCIAL, 'zh')).toBe(true)
    // 未知 descriptor 没有声明，不因为这份表而丢数据。
    expect(zeroXRouterCalendarPublishesLocale('macro-calendar-0xrouter-unknown', 'en')).toBe(true)
  })
})

describe('the source status the reader sees', () => {
  it('marks an empty batch for an unpublished locale as "no such language", not "no events"', () => {
    expect(marketCalendarSourceStatus('success-empty', FINANCIAL, 'en')).toBe('no-locale-rows')
    expect(marketCalendarSourceStatus('success-empty', CENTRAL, 'en')).toBe('no-locale-rows')
  })

  it('keeps "no events this month" for a locale the source does publish', () => {
    expect(marketCalendarSourceStatus('success-empty', FINANCIAL, 'zh')).toBe('success-empty')
    expect(marketCalendarSourceStatus('success-empty', ECONOMIC, 'en')).toBe('success-empty')
  })

  it('never rewrites a batch that did carry rows', () => {
    for (const status of ['success', 'partial', 'all-skipped'] as const) {
      expect(marketCalendarSourceStatus(status, FINANCIAL, 'en')).toBe(status satisfies MarketCalendarSource['status'])
    }
  })
})
