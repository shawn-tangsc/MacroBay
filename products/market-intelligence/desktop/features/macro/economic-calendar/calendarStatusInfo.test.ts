import { describe, expect, it } from 'vitest'

import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { productText } from '../../../shared/i18n/productText'
import { calendarSourceStatusFragments } from './MarketCalendarSourceStatus'

const text = productText['zh-CN'].pages.intelligence.portal.calendar
const observedAt = '2026-08-05T08:00:00.000Z'
const formatTime = (value: string): string => value

function source(overrides: Partial<MarketCalendarSource> = {}): MarketCalendarSource {
  return { eventType: 'economic-indicator', status: 'success', sourceObservedAt: observedAt, ...overrides }
}

/**
 * R35 验收按**文案键的值**判，不做中文字面搜索：这里比的全是 `text.market.*` 解析出来的句子，
 * 换了措辞用例跟着走，不会因为改字而漏。
 */
const normalSentences = (): string[] => [
  text.market.refreshOutcome.succeeded,
  text.market.refreshTrigger.manual,
  text.market.refreshTrigger.automatic,
  text.market.statuses.success,
  text.market.lastGivenAt,
  text.market.automaticRefresh.replace('{interval}', '30')
]

describe('the calendar status body', () => {
  it('keeps every normal sentence out of the body, and puts them in the info lines', () => {
    const fragments = calendarSourceStatusFragments(
      source({ latestAttempt: { state: 'succeeded', attemptedAt: observedAt, trigger: 'automatic' } }),
      text,
      formatTime
    )
    const body = fragments.body.join(' · ')
    const detail = fragments.detail.join(' · ')
    for (const sentence of normalSentences()) {
      expect(body, `body must not carry "${sentence}"`).not.toContain(sentence)
    }
    expect(detail).toContain(text.market.refreshOutcome.succeeded)
    expect(detail).toContain(text.market.refreshTrigger.automatic)
    expect(detail).toContain(text.market.statuses.success)
    expect(detail).toContain(text.market.lastGivenAt)
    expect(detail).toContain(observedAt)
    expect(detail).toContain(text.market.automaticRefresh.replace('{interval}', '30'))
    // 一句只出现一次：ⓘ 不重复正文那句（正文此时是空的）。
    expect(fragments.body).toHaveLength(0)
  })

  // 时间前进 ⟺ 「本次尚未刷新」不出现：来源给过这条时，这句话必须消失。
  it('drops the not-attempted sentence once the source has given anything with a time', () => {
    const facts = calendarSourceStatusFragments(source({ latestAttempt: undefined }), text, formatTime)
    expect(facts.body.join(' · ')).not.toContain(text.market.refreshOutcome.unattempted)
  })

  it.each([
    ['refresh failed', { latestAttempt: { state: 'failed' as const, attemptedAt: observedAt, failureCode: 'response-unavailable' as const } },
      [text.market.refreshOutcome.failed, text.market.attemptFailure['response-unavailable']]],
    // 「本次尚未刷新」只在一条观测都没有时成立（有时间就不再这么说，否则与时间自相矛盾）。
    ['not attempted', { latestAttempt: undefined, sourceObservedAt: null }, [text.market.refreshOutcome.unattempted]],
    ['partial batch', { status: 'partial' as const }, [text.market.statuses.partial]],
    ['parse limited', { status: 'all-skipped' as const }, [text.market.statuses['all-skipped']]],
    ['no usable batch', { status: 'unavailable' as const }, [text.market.statuses.unavailable]],
    // 「确实没有」是那一半，留在正文，不是「读不到」。
    ['empty batch', { status: 'success-empty' as const }, [text.market.statuses['success-empty']]]
  ])('shows the %s verdict in the body', (_name, overrides, expected) => {
    const fragments = calendarSourceStatusFragments(source(overrides as Partial<MarketCalendarSource>), text, formatTime)
    const body = fragments.body.join(' · ')
    for (const sentence of expected) expect(body).toContain(sentence)
  })

  it('says it is showing previous data, with its time, and does not repeat that line in the info', () => {
    const fragments = calendarSourceStatusFragments(
      source({ latestAttempt: { state: 'failed', attemptedAt: observedAt, failureCode: 'storage-pressure' } }),
      text,
      formatTime
    )
    const body = fragments.body.join(' · ')
    const detail = fragments.detail.join(' · ')
    expect(body).toContain(text.market.retainedData)
    expect(body).toContain(observedAt)
    // 同一句不许两边都有：ⓘ 里不再重复「刷新失败」「显示上次数据」。
    expect(detail).not.toContain(text.market.refreshOutcome.failed)
    expect(detail).not.toContain(text.market.retainedData)
    expect(detail).not.toContain(observedAt)
  })
})
