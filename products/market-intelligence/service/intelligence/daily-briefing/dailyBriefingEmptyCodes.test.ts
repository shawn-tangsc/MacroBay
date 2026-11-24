import { describe, expect, it } from 'vitest'

import { nextEmptyCode } from './dailyBriefingEmptyCodes'
import type { DailyBriefingCalendarEvent, DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/**
 * 「整周一条已分级都没有」= **我们还没定档**，不是「这周没有高影响事件」（R44 §6.2）。
 *
 * 未分级就是 `importance` 缺省（R44 决定：列可空三值、`NULL` 即未分级、**不引入第四档**），
 * 所以这里的判据只能是 `every(event => event.importance === undefined)`；哪天有人给它造出
 * `'ungraded'`，这组用例会红——那是违反方案的改动，不是这里要适配的。
 *
 * 那个码只决定「说哪句话」，句子本身归界面设计（文案签字后才落）。
 */
const nextWindowEvent = (overrides: Partial<DailyBriefingCalendarEvent>): DailyBriefingCalendarEvent => ({
  eventKey: 'TEST.EVENT',
  title: '测试事件',
  scheduledAt: '2026-11-03T18:00:00.000Z',
  lifecycleState: 'scheduled',
  category: 'economic-indicator',
  surprise: { direction: 'consensus-unavailable' },
  ...overrides
} as DailyBriefingCalendarEvent)

/** `nextEmptyCode` 只读日历状态、事件与窗口边界：这里给足这几样，其余字段不是它的输入。 */
const packet = (
  events: readonly DailyBriefingCalendarEvent[],
  calendarState: DailyBriefingFactPacket['calendar']['state'] = 'available'
): DailyBriefingFactPacket => ({
  asOf: '2026-10-30T00:00:00.000Z',
  windowStart: '2026-10-29T00:00:00.000Z',
  windowEnd: '2026-10-30T00:00:00.000Z',
  timeZone: 'Asia/Shanghai',
  calendar: { state: calendarState, events }
} as unknown as DailyBriefingFactPacket)

describe('nextEmptyCode says why the next-7-days block has nothing', () => {
  it('每一场都还没定档时，说「未定档」而不是「没有高影响」', () => {
    expect(nextEmptyCode(packet([
      nextWindowEvent({ eventKey: 'US.CPI.NSA.YOY', title: 'CPI 年率' }),
      nextWindowEvent({ eventKey: 'US.NONFARM_PAYROLLS', title: '非农就业', scheduledAt: '2026-11-05T12:30:00.000Z' })
    ]))).toBe('next-7d-importance-unknown')
  })

  it('只要有一场定了档（哪怕只是中/低），就仍说「没有高影响」——那种「没有」是我们判得出来的', () => {
    expect(nextEmptyCode(packet([
      nextWindowEvent({ eventKey: 'US.CPI.NSA.YOY', importance: 'medium' }),
      nextWindowEvent({ eventKey: 'US.NONFARM_PAYROLLS' })
    ]))).toBe('next-7d-no-high-impact-event')
  })

  it('未来 7 天本来就没有事件时，不说「未定档」', () => {
    expect(nextEmptyCode(packet([
      nextWindowEvent({ eventKey: 'US.CPI.NSA.YOY', lifecycleState: 'released', scheduledAt: '2026-10-29T12:30:00.000Z' })
    ]))).toBe('next-7d-no-high-impact-event')
  })

  it('只有一场已取消的未分级事件时，也不算「有事件没定档」', () => {
    expect(nextEmptyCode(packet([
      nextWindowEvent({ eventKey: 'US.CPI.NSA.YOY', lifecycleState: 'cancelled' })
    ]))).toBe('next-7d-no-high-impact-event')
  })

  it('日历本身读不到时，理由仍在它自己那一档上，不被「未定档」顶替', () => {
    expect(nextEmptyCode(packet([], 'unavailable'))).toBe('calendar-unavailable')
    expect(nextEmptyCode(packet([], 'source-disabled'))).toBe('calendar-source-disabled')
  })
})
