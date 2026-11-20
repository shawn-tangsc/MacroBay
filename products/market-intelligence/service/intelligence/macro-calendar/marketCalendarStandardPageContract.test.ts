import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { isMarketCalendarPage } from '../../../contracts/macro/marketCalendarQueryContracts'
import { createStandardMonthPageReader } from './marketCalendarStandardMonthPage'
import { ensureCalendarStandardTables, upsertCalendarStandardRow, type CalendarStandardRow }
  from './marketCalendarStandardTable'

/**
 * **页面级用例**：拿真实适配器 + 真实读模型的输出跑页面校验。
 *
 * 之前的用例都断在行上，而 `isMarketCalendarPage` 这一层从来没被真的跑过——切到标准表之后
 * 适配器每行都写 `timePrecision / releaseStatus / rowKind / sourceFeedId`，白名单里没有这四个，
 * 于是整页判非法、读者看到「读不到」，行级断言却全绿。
 */
const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', timePrecision: 'minute',
  status: 'published', valuesJson: '{"actual":"3.7"}', valueState: 'present', importance: 'high',
  sourceProviderId: 'macro-calendar-bls', sourceEventId: 'US.CPI.RELEASE.2026-M10',
  parserVersion: 'v1', observedAt: '2026-11-10T13:31:00.000Z', firstSeenAt: '2026-11-10T13:31:00.000Z'
}

describe('页面级契约：适配器真的输出，必须被判合法', () => {
  it('一页真实输出通过 isMarketCalendarPage（这条之前从未被跑过）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    upsertCalendarStandardRow(database, { ...base, metricKey: 'evt.central-bank-speech',
      periodKey: '2026-11-12T14:10', scheduledDate: '2026-11-12', scheduledAt: '2026-11-12T14:10:00.000Z',
      valuesJson: '{}', valueState: 'missing', sourceEventId: 'r-speech' })
    const page = createStandardMonthPageReader({ database, resolveTitle: (row) => row.metricKey })
      .queryMonth({ month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z' })
    expect(page.state).toBe('available')
    // 关键断言：不是「字段都在」，而是**这一页能被合同接受**。
    expect(isMarketCalendarPage(page, { month: '2026-11', locale: 'zh', asOf: '2026-11-14T00:00:00.000Z' }))
      .toBe(true)
  })
})
