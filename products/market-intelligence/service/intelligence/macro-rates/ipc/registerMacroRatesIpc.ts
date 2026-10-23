import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import {
  isMacroRatesSnapshotQuery,
  macroRatesSnapshotPublicPolicy,
  parseMacroRatesSnapshot,
  type MacroRatesSnapshotView
} from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesSnapshot } from '../macroRatesSnapshotQuery'

const productId = 'market-intelligence'

/**
 * Read-only door for the daily FRED rate readings the 市场状态 block shows on its 美债 10Y and 实际利率
 * rows. The readings come from the stored metric events; the handler validates the empty request,
 * re-parses the service's own snapshot through the product boundary, and collapses every failure to
 * `unavailable` — the row must show 未接入 rather than a stale or invented level.
 */
export type MacroRatesSnapshotIpcQuery = Readonly<{ snapshot: () => MacroRatesSnapshot }>

export function registerMacroRatesIpc(register: ProductIpcRegistrar, query: MacroRatesSnapshotIpcQuery): void {
  register(productId, macroRatesSnapshotPublicPolicy.method, async payload => {
    try {
      if (!isMacroRatesSnapshotQuery(payload)) return unavailable()
      return parseMacroRatesSnapshot(query.snapshot()) ?? unavailable()
    } catch {
      return unavailable()
    }
  })
}

function unavailable(): MacroRatesSnapshotView {
  return Object.freeze({ state: 'unavailable' as const })
}
