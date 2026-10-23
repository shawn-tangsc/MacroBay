import { describe, expect, it } from 'vitest'

import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { projectDashboardMacroSourceState, type DashboardMacroSourceState } from './dashboardMacroSourceModel'

const asOf = '2026-09-14T12:00:00.000Z'
const reading = { seriesId: 'dxy-synthetic', level: 101.42, atMs: Date.parse(asOf), returns: { '15m': 0.1 }, synthetic: true as const }
const view = (readings: readonly (typeof reading)[], enabled: boolean, hasCredential: boolean): MacroMarketSnapshotView =>
  ({ state: readings.length > 0 ? 'available' : 'empty', asOf, source: { enabled, hasCredential }, readings, caveats: [] })
const project = (input: Partial<Parameters<typeof projectDashboardMacroSourceState>[0]>): DashboardMacroSourceState =>
  projectDashboardMacroSourceState({ client: true, state: 'ready', ...input })

describe('dashboard macro source state', () => {
  it('says 可用 only when the snapshot actually carries a reading', () => {
    expect(project({ snapshot: view([reading], true, true) })).toBe('available')
    // The same snapshot with an empty store is never available, whatever the switch says.
    for (const source of [[true, true], [true, false], [false, true], [false, false]] as const) {
      expect(project({ snapshot: view([], source[0], source[1]) })).not.toBe('available')
    }
  })

  it('separates enabled-but-empty, switched off and unkeyed instead of folding them together', () => {
    expect(project({ snapshot: view([], true, true) })).toBe('awaiting-collection')
    expect(project({ snapshot: view([], false, true) })).toBe('disabled')
    expect(project({ snapshot: view([], true, false) })).toBe('credential-missing')
    // A source that was switched off after collecting still has its stored level: the data wins.
    expect(project({ snapshot: view([reading], false, false) })).toBe('available')
  })

  it('reports unavailable for a missing client, a failed read or an unusable answer', () => {
    expect(project({ client: false, snapshot: view([reading], true, true) })).toBe('unavailable')
    expect(project({ state: 'unavailable' })).toBe('unavailable')
    expect(project({ state: 'unavailable', snapshot: view([reading], true, true) })).toBe('unavailable')
    expect(project({ state: 'ready' })).toBe('unavailable')
    expect(project({ state: 'ready', snapshot: { state: 'unavailable' } })).toBe('unavailable')
  })

  it('reports loading only while the first read is in flight', () => {
    expect(project({ state: 'loading' })).toBe('loading')
    expect(project({ state: 'loading', snapshot: view([], true, true) })).toBe('loading')
  })
})
