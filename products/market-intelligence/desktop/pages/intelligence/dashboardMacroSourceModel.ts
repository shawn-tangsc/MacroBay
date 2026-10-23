import type { MacroMarketSnapshotView } from '../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketViewState } from '../../features/industry/cross-asset/useMacroMarketSnapshot'

/**
 * The states the 来源状态 strip can show for the macro-market source. `available` is reserved for a
 * snapshot that actually carries a reading: an enabled source with an empty store is stated as
 * waiting for its first collection, never as working.
 */
export type DashboardMacroSourceState =
  | 'loading'
  | 'available'
  | 'awaiting-collection'
  | 'disabled'
  | 'credential-missing'
  | 'unavailable'

export function projectDashboardMacroSourceState(input: Readonly<{
  client: boolean
  state: MacroMarketViewState
  snapshot?: MacroMarketSnapshotView
}>): DashboardMacroSourceState {
  if (!input.client) return 'unavailable'
  if (input.state === 'loading') return 'loading'
  if (input.state === 'unavailable' || !input.snapshot) return 'unavailable'
  if (input.snapshot.state === 'unavailable') return 'unavailable'
  if (input.snapshot.readings.length > 0) return 'available'
  // No reading at all: the strip names the reason instead of dressing the gap as a working source.
  if (!input.snapshot.source.enabled) return 'disabled'
  if (!input.snapshot.source.hasCredential) return 'credential-missing'
  return 'awaiting-collection'
}
