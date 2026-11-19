import { describe, expect, it } from 'vitest'

import { dayGroups, dayTierOf } from './macroIndicatorDrawerModel'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 右列分组改成**一层**（用户 2026-11-19：两层嵌套看不出重点）。
 *
 * 判据：组头就是重点——一级、二级置顶；其余（三级/未分级/无分级的活动）合成一组并**默认折叠**。
 * 事件不另开一组：与分级混在一起会变成第三套分类，事件在「接下来要看的」里按高重要性单独列。
 */
const event = (overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent => ({
  eventKey: `k-${Math.random()}`,
  title: '事件',
  countryCode: 'US',
  eventType: 'economic-indicator',
  importance: 'medium',
  scheduledAt: '2026-11-25T13:30:00.000Z',
  sourceObservedAt: '2026-11-19T00:00:00.000Z',
  coverage: 'observed-unverified',
  eventNameKey: 'US.CPI.NSA.YOY',
  ...overrides
} as MarketCalendarEvent)

const groups = (events: readonly MarketCalendarEvent[]) => dayGroups(events, '2026-11-25', 'Asia/Shanghai',
  '{name} · {index}/{total}',
  (count) => `其余 ${count} 条`,
  (tier, count) => `${tier} ${count} 条`)

describe('dayGroups: one level, tier first', () => {
  it('puts tier 1 and tier 2 on top, and folds everything else into one collapsed group', () => {
    const first = event({ eventKey: 'a', eventNameKey: 'US.CPI.NSA.YOY' })
    const second = event({ eventKey: 'b', eventNameKey: 'DE.CPI.NSA.YOY' })
    const untiered = event({ eventKey: 'c', eventNameKey: undefined })
    const speech = event({ eventKey: 'd', eventType: 'central-bank-activity', eventNameKey: undefined,
      importance: 'high' })
    const result = groups([untiered, speech, second, first])
    // 四段顺序固定：一级 → 二级 → 高重要性事件 → 其余。
    expect(result.map((group) => group.key)).toEqual(['tier-1', 'tier-2', 'high-events', 'rest'])
    expect(result[3]!.collapsedByDefault).toBe(true)
    // 未分级指标进「其余」；**高重要性事件不在这里**（它自己一段、不折叠）。
    expect(result[3]!.items).toHaveLength(1)
    expect(result[2]!.items).toHaveLength(1)
  })

  it('omits a tier group that has no rows, and keeps tier 3 out of the top', () => {
    const onlyTier2 = event({ eventKey: 'b', eventNameKey: 'DE.CPI.NSA.YOY' })
    const result = groups([onlyTier2])
    expect(result.map((group) => group.key)).toEqual(['tier-2'])
    expect(result[0]!.collapsedByDefault).toBeUndefined()
  })

  it('classifies an event with no metric code as untiered', () => {
    expect(dayTierOf(event({ eventNameKey: undefined }))).toBe('other')
  })
})

it('lists high-importance events in their own open group, not inside the folded rest', () => {
  const speech = event({ eventKey: 's1', eventType: 'central-bank-activity', eventNameKey: undefined,
    importance: 'high' })
  const report = event({ eventKey: 's2', eventType: 'financial-event', eventNameKey: undefined,
    importance: 'high' })
  const medium = event({ eventKey: 's3', eventType: 'central-bank-activity', eventNameKey: undefined,
    importance: 'medium' })
  const result = groups([speech, report, medium])
  expect(result.map((group) => group.key)).toEqual(['high-events', 'rest'])
  expect(result[0]!.items).toHaveLength(2)
  // 只有「其余」默认折叠；高重要性那一段是展开的。
  expect(result[0]!.collapsedByDefault).toBeUndefined()
  expect(result[1]!.collapsedByDefault).toBe(true)
  expect(result[1]!.items).toHaveLength(1)
})
