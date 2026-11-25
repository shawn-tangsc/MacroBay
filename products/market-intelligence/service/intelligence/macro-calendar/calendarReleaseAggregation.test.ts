import { describe, expect, it } from 'vitest'

import { calendarReleaseKeyOf, collapseCalendarReleases, highestCalendarImportance }
  from './calendarReleaseAggregation'
import { marketCalendarReleaseGroupByMetricKey } from './marketCalendarReleaseGroups'

/**
 * 一次发布只出一条提醒（R44 技术方案 §4.3 / PRD §8.5）。
 *
 * 判据都是「删掉聚合就红」的那种：
 * - CPI 与核心 CPI 同时刻 → 一条，档取高；
 * - 不同族同时刻 → 两条（不许把两场发布并成一场）；
 * - 没有时刻 → 不并；
 * - 组内取最高档；一条有档都没有 → 未分级（不进任何已勾档位）。
 */
const groupOf = (metricKey: string) => marketCalendarReleaseGroupByMetricKey[metricKey]

describe('一次发布只合成一条：发布组优先，其次 (国家, 族, 时刻)', () => {
  it('CPI 与核心 CPI 同一时刻 → 一条，档取高，代表行是档最高的那条', () => {
    const rows = [
      { metricKey: 'US.CPI.NSA.YOY', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', importance: 'high' as const },
      { metricKey: 'US.CORE_CPI.NSA.YOY', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', importance: 'high' as const }
    ]
    const collapsed = collapseCalendarReleases(rows, groupOf)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.importance).toBe('high')
    expect(collapsed[0]!.row.metricKey).toBe('US.CPI.NSA.YOY')
  })

  it('不同族在同一时刻 → 仍是两条（不许把两场发布并成一场）', () => {
    const collapsed = collapseCalendarReleases([
      { metricKey: 'US.CPI.NSA.YOY', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', importance: 'high' as const },
      { metricKey: 'US.RETAIL_SALES.SA.MOM', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', importance: 'medium' as const }
    ], groupOf)
    expect(collapsed.map((entry) => entry.row.metricKey)).toEqual(['US.CPI.NSA.YOY', 'US.RETAIL_SALES.SA.MOM'])
  })

  it('没有时刻的行不并：不知道是不是同一场，就不合成一条', () => {
    const rows = [
      { metricKey: 'US.CPI.NSA.YOY', countryCode: 'US' },
      { metricKey: 'US.CORE_CPI.NSA.YOY', countryCode: 'US' }
    ]
    expect(collapseCalendarReleases(rows, groupOf)).toHaveLength(2)
    expect(calendarReleaseKeyOf(rows[0]!, groupOf)).toBeUndefined()
  })

  it('组内取最高档：一条高、一条未分级 → 高；全都未分级 → 不猜（undefined）', () => {
    expect(highestCalendarImportance(['medium', undefined, 'high'])).toBe('high')
    expect(highestCalendarImportance([undefined, undefined])).toBeUndefined()
    const collapsed = collapseCalendarReleases([
      { metricKey: 'US.CPI.NSA.YOY', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z' },
      { metricKey: 'US.CORE_CPI.NSA.YOY', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', importance: 'high' as const }
    ], groupOf)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.importance).toBe('high')
    // 代表行取有档的那条：标题跟着档走，读者不会看到「未分级」配一个高影响的名字。
    expect(collapsed[0]!.row.metricKey).toBe('US.CORE_CPI.NSA.YOY')
  })

  it('官方行自带发布组：直接用，不再按族猜；改期后两条都还在（时刻进键）', () => {
    const rows = [
      { releaseGroupKey: 'US.BEA.GDP.2026-Q3.ADVANCE', countryCode: 'US', scheduledAt: '2026-10-29T12:30:00.000Z', importance: 'high' as const },
      { releaseGroupKey: 'US.BEA.GDP.2026-Q3.ADVANCE', countryCode: 'US', scheduledAt: '2026-11-05T12:30:00.000Z', importance: 'high' as const }
    ]
    const collapsed = collapseCalendarReleases(rows, groupOf)
    expect(collapsed).toHaveLength(2)
    expect(calendarReleaseKeyOf(rows[0]!, groupOf)).toBe('US.BEA.GDP.2026-Q3.ADVANCE|2026-10-29T12:30:00.000Z')
  })
})