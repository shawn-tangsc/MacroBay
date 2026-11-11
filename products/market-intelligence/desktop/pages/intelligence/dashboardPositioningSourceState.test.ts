import { describe, expect, it } from 'vitest'

import { projectPositioningCardState, projectPositioningCell, projectPositioningCells } from './dashboardPositioningSourceState'
import type { CellReadDecision } from './dashboardCellEnabled'
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
/** 两格都去读（源启用、格开着）。 */
const bothRead = { oi: { kind: 'read', sourceId: 'binance-futures-positioning', explicit: false } as CellReadDecision, funding: { kind: 'read', sourceId: 'binance-futures-positioning', explicit: false } as CellReadDecision }
const cellOff = { kind: 'not-enabled' } as CellReadDecision
const sourceOff = { kind: 'source-disabled', sourceId: 'binance-futures-positioning' } as CellReadDecision
const sourceUnknown = { kind: 'source-unknown', sourceId: 'binance-futures-positioning' } as CellReadDecision

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
      decisions: { oi: bothRead.oi, funding: cellOff },
      positioning: available,
      funding
    })
    expect(oneOff).toMatchObject({ oi: 'available', funding: 'disabled' })
    expect(projectPositioningCardState(oneOff)).toBeUndefined()

    const oneUnreadable = projectPositioningCells({
      configured: true,
      decisions: bothRead,
      positioning: available,
      funding: { state: 'unavailable' }
    })
    expect(oneUnreadable).toMatchObject({ oi: 'available', funding: 'unreadable', reasons: { funding: 'query-failed' } })
    expect(projectPositioningCardState(oneUnreadable)).toBeUndefined()
  })

  it('degrades the whole card only when neither cell is usable, in the same order', () => {
    const bothDisabled = projectPositioningCells({ configured: true, decisions: { oi: cellOff, funding: cellOff }, positioning: available, funding })
    expect(projectPositioningCardState(bothDisabled)).toBe('disabled')

    const mixed = projectPositioningCells({
      configured: true, decisions: { oi: cellOff, funding: bothRead.funding },
      positioning: available, funding: { state: 'unavailable' }
    })
    // 一格没启用、一格读不到：先说的是「来源没有启用」——顺序与判定一致。
    expect(projectPositioningCardState(mixed)).toBe('disabled')

    const bothUnreadable = projectPositioningCells({
      configured: true, decisions: bothRead,
      positioning: { state: 'unavailable', cause: 'contract-mismatch', onReload: () => undefined },
      funding: { state: 'unavailable' }
    })
    expect(projectPositioningCardState(bothUnreadable)).toBe('unreadable')
    expect(bothUnreadable.reasons.oi).toBe('contract-mismatch')
  })

  it('separates "the reader turned the cell off" from "the source itself is switched off"', () => {
    // 格关了：未启用，但没有「哪个源」可讲（读者关的是这一格）。
    const off = projectPositioningCells({ configured: true, decisions: { oi: cellOff, funding: cellOff }, positioning: available, funding })
    expect(off).toMatchObject({ oi: 'disabled', funding: 'disabled', sources: {} })
    // 源关了（用户 2026-11-11 现场）：一样是「未启用」，但要把**是哪个源**带出来，卡片才能说「Binance 没有启用」。
    const source = projectPositioningCells({ configured: true, decisions: { oi: sourceOff, funding: sourceOff }, positioning: available, funding })
    expect(source).toMatchObject({ oi: 'disabled', funding: 'disabled', sources: { oi: 'binance-futures-positioning', funding: 'binance-futures-positioning' } })
    // 源状态还没读到：那是「读不到」，不是「没启用」。
    const unknown = projectPositioningCells({ configured: true, decisions: { oi: sourceUnknown, funding: sourceUnknown }, positioning: available, funding })
    expect(unknown).toMatchObject({ oi: 'unreadable', funding: 'unreadable' })
    expect(projectPositioningCardState(unknown)).toBe('unreadable')
  })
})
