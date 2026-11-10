import { describe, expect, it } from 'vitest'

import { projectPositioningCardState, projectPositioningCell, projectPositioningCells } from './dashboardPositioningSourceState'
import type { DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'
import type { DashboardPositioningViewState } from './dashboardOpenInterestModel'

const available: DashboardPositioningViewState = {
  state: 'available', window: '7d', onReload: () => undefined,
  btc: [{ observedAt: '2026-11-11T00:00:00.000Z', notionalUsd: 1 }, { observedAt: '2026-11-11T01:00:00.000Z', notionalUsd: 2 }],
  eth: [{ observedAt: '2026-11-11T00:00:00.000Z', notionalUsd: 1 }, { observedAt: '2026-11-11T01:00:00.000Z', notionalUsd: 2 }],
  hints: [], hiddenHits: 0, signal: { state: 'hidden' },
  pointAt: '2026-11-11T01:00:00.000Z', newestReadingAt: '2026-11-11T01:00:00.000Z'
}
const funding: DashboardFundingRateHistoryState = { state: 'available', btc: [], eth: [] }

describe('positioning source availability', () => {
  it('judges in the fixed order: missing, then disabled, then unreadable', () => {
    // 没有源可关联时，就算同时没启用、也没读到，说的仍然是「还没有配置来源」。
    expect(projectPositioningCell({ configured: false, enabled: false, read: 'unavailable' })).toBe('missing')
    expect(projectPositioningCell({ configured: true, enabled: false, read: 'unavailable' })).toBe('disabled')
    expect(projectPositioningCell({ configured: true, enabled: true, read: 'unavailable' })).toBe('unreadable')
  })

  it('never turns "nothing collected" or a partial funding read into one of the three states', () => {
    // 空态是读到了、确实没有数据；三态是拿不到/没开/没配，两者不许互相冒充。
    expect(projectPositioningCell({ configured: true, enabled: true, read: 'empty' })).toBe('available')
    expect(projectPositioningCell({ configured: true, enabled: true, read: 'partial' })).toBe('available')
    expect(projectPositioningCell({ configured: true, enabled: true, read: 'available' })).toBe('available')
  })

  it('keeps the card usable while one of the two cells is available', () => {
    const oneOff = projectPositioningCells({
      configured: true,
      enabled: { oi: true, funding: false },
      positioning: available,
      funding
    })
    expect(oneOff).toMatchObject({ oi: 'available', funding: 'disabled' })
    expect(projectPositioningCardState(oneOff)).toBeUndefined()

    const oneUnreadable = projectPositioningCells({
      configured: true,
      enabled: { oi: true, funding: true },
      positioning: available,
      funding: { state: 'unavailable' }
    })
    expect(oneUnreadable).toMatchObject({ oi: 'available', funding: 'unreadable', reasons: { funding: 'query-failed' } })
    expect(projectPositioningCardState(oneUnreadable)).toBeUndefined()
  })

  it('degrades the whole card only when neither cell is usable, in the same order', () => {
    const bothDisabled = projectPositioningCells({ configured: true, enabled: { oi: false, funding: false }, positioning: available, funding })
    expect(projectPositioningCardState(bothDisabled)).toBe('disabled')

    const mixed = projectPositioningCells({
      configured: true, enabled: { oi: false, funding: true },
      positioning: available, funding: { state: 'unavailable' }
    })
    // 一格没启用、一格读不到：先说的是「来源没有启用」——顺序与判定一致。
    expect(projectPositioningCardState(mixed)).toBe('disabled')

    const bothUnreadable = projectPositioningCells({
      configured: true, enabled: { oi: true, funding: true },
      positioning: { state: 'unavailable', cause: 'contract-mismatch', onReload: () => undefined },
      funding: { state: 'unavailable' }
    })
    expect(projectPositioningCardState(bothUnreadable)).toBe('unreadable')
    expect(bothUnreadable.reasons.oi).toBe('contract-mismatch')
  })
})
