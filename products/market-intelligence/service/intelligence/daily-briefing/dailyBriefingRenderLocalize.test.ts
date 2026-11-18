import { expect, it } from 'vitest'

import { assertNoSerializedValueObjects } from './briefingDisplayValue'
import { selectMacroCandidates } from './dailyBriefingDocumentMacro'
import { readCalendar } from './dailyBriefingRenderLocalize'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefingSourceDeps } from './dailyBriefingSource'

/**
 * 线上缺陷（2026-11-18）：标准表那一行的 `values_json.previous` 本身是
 * `'{"displayValue":"4.7%"}'`，日报读日历值时又把它包成 `{ displayValue: … }`，
 * 于是正文印出 `前值 {"displayValue":"4.7%"}`。
 *
 * 判据：值对象进 packet 之前只解释一次 → 文档里 `previous === '4.7%'`；
 * 去掉这道解释，断言必须红（`briefing-display-value-not-localized:<事件>:previous`）。
 */

const marketEvent = {
  eventKey: 'evt-1',
  title: '至9月三个月ILO失业率',
  countryCode: 'GB',
  countryName: '英国',
  scheduledAt: '2026-11-17T07:00:00.000Z',
  importance: 'high',
  eventType: 'economic-indicator',
  providerActual: { displayValue: '4.6%' },
  providerPrevious: { displayValue: '{"displayValue":"4.7%"}' },
  consensus: { displayValue: '4.7%' }
}

const deps = {
  publicQuery: {
    queryMacroEconomicCalendarMonth: async () => ({ state: 'unavailable' as const }),
    queryMarketCalendarMonth: () => ({ state: 'available' as const, events: [marketEvent] })
  }
} as unknown as DailyBriefingSourceDeps

it('explains a serialized calendar value exactly once, where the briefing reads it', async () => {
  const calendar = await readCalendar(deps, '2026-11-18T00:08:03.000Z', 'zh-CN', true)
  expect(calendar.events).toHaveLength(1)
  expect(calendar.events[0]?.previous).toBe('4.7%')
  expect(calendar.events[0]?.actual).toBe('4.6%')
  expect(calendar.events[0]?.consensus).toBe('4.7%')

  // 文档的宏观行就是这些候选：进文档前断言必须通过（坏串在这里就该被拦下）。
  const packet = {
    calendar,
    windowStart: '2026-11-17T00:00:00.000Z',
    windowEnd: '2026-11-18T00:08:03.000Z',
    timeZone: 'Asia/Shanghai'
  } as unknown as DailyBriefingFactPacket
  const macro = selectMacroCandidates(packet)
  expect(macro[0]?.previous).toBe('4.7%')
  expect(() => assertNoSerializedValueObjects({ news: { macro } })).not.toThrow()
})
