import { describe, expect, it } from 'vitest'

import { officialCalendarFeedsAvailability, OFFICIAL_CALENDAR_SOURCE_IDS } from './officialCalendarAvailability'
import { panelView } from './sourceProjection'

const fed = (enabled: boolean) => ({ sourceId: 'macro-calendar-fed', enabled })
const bea = (enabled: boolean) => ({ sourceId: 'macro-calendar-bea', enabled })
const bls = (enabled: boolean, unavailable?: { reasonCode: string }) => ({
  sourceId: 'macro-calendar-bls', enabled, ...(unavailable === undefined ? {} : { unavailable })
})

/**
 * 三态口径（与 `市场状态` 对齐，2026-11-09）：
 * - 全部未启用 → `disabled`（读者关的，去启用就能恢复）；
 * - 至少一条**可用且启用** → `enabled`（有没有内容交给月投影回答）；
 * - 没有可用腿、但有"已判定不可用"的腿（BLS 403 停用）→ `unavailable`，**不许落进 disabled**，
 *   也不许被当成「本月没有」。
 */
describe('official calendar feeds availability', () => {
  // 这份清单在这里是**唯一**一处逐字写下的：实现改成读注册表（`kind: 'official-calendar'` 且挂
  // `economic-calendar`），所以这条用例就是那个集合的钉子——注册表加了第四条官方源，它会红，提醒
  // 看一眼三态口径要不要一起动。
  it('names exactly the three official calendar sources', () => {
    expect([...OFFICIAL_CALENDAR_SOURCE_IDS]).toEqual(['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'])
  })

  it('reports disabled only when every official leg is switched off', () => {
    expect(officialCalendarFeedsAvailability([fed(false), bea(false), bls(false)])).toEqual({ state: 'disabled' })
  })

  it('reports enabled as soon as one usable official leg is on', () => {
    expect(officialCalendarFeedsAvailability([fed(true), bea(false), bls(false)])).toEqual({ state: 'enabled' })
  })

  it('never treats the stopped BLS leg as a usable one, and never as "disabled by the reader" when it is on', () => {
    // 读者把 BLS 开着，但它是"取不到"：不算可用腿，也不能说成"来源全关"。
    expect(officialCalendarFeedsAvailability([fed(false), bea(false), bls(true, { reasonCode: 'official-endpoint-returned-403' })]))
      .toEqual({ state: 'unavailable', reasonCode: 'official-endpoint-returned-403' })
    // 三条都关着（含 BLS）：这是"读者关的"，全新安装也落这一档——先给可执行的那句话。
    expect(officialCalendarFeedsAvailability([fed(false), bea(false), bls(false, { reasonCode: 'official-endpoint-returned-403' })]))
      .toEqual({ state: 'disabled' })
  })

  it('still says enabled when a usable leg is on alongside the stopped one', () => {
    expect(officialCalendarFeedsAvailability([fed(true), bea(false), bls(true, { reasonCode: 'official-endpoint-returned-403' })]))
      .toEqual({ state: 'enabled' })
  })
})

describe('the economic-calendar panel projection', () => {
  it('carries the verdict so the page never walks the registry itself', () => {
    const enabledById = { 'macro-calendar-fed': true, 'macro-calendar-bea': false, 'macro-calendar-bls': true }
    const view = panelView('economic-calendar', { enabledById })!
    expect(view.calendarOfficialFeeds).toEqual({ state: 'enabled' })
    // 官方腿的不可用声明跟着源一起投影出来（不是另算一份）。
    const blsView = view.providers.flatMap((provider) => provider.sources).find((source) => source.sourceId === 'macro-calendar-bls')
    expect(blsView?.unavailable).toMatchObject({ reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped' })
  })

  it('reports disabled on a fresh profile set, which is what the page draws as "no source enabled"', () => {
    // 全新安装：官方腿一条都没启用 → 页面该说"来源全关、去启用"，而不是先去讲 BLS 的 403。
    const view = panelView('economic-calendar', { enabledById: {} })!
    expect(view.calendarOfficialFeeds).toEqual({ state: 'disabled' })
  })

  it('is attached to the economic-calendar panel only, so other panels keep their shape', () => {
    expect(panelView('dashboard', { enabledById: { 'macro-calendar-fed': true } })?.calendarOfficialFeeds).toBeUndefined()
    expect(panelView('economic-calendar', { enabledById: { 'macro-calendar-fed': true } })?.calendarOfficialFeeds).toEqual({ state: 'enabled' })
  })
})
