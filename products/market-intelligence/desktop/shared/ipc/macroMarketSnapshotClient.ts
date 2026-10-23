import {
  macroMarketSnapshotPublicPolicy,
  parseMacroMarketSnapshot,
  type MacroMarketSnapshotView
} from '../../../contracts/macro/macroMarketSnapshotContracts'

/** The request carries no arguments; the answer is re-validated on arrival, never trusted. */
export function createMacroMarketSnapshotClient(invoke: (productId: string, method: string, payload: unknown) => Promise<unknown> =
  (productId, method, payload) => window.platform.products.invoke(productId, method, payload)) {
  return {
    async query(): Promise<MacroMarketSnapshotView> {
      try {
        const result = await invoke('market-intelligence', macroMarketSnapshotPublicPolicy.method, {})
        return parseMacroMarketSnapshot(result) ?? unavailable()
      } catch { return unavailable() }
    }
  }
}

function unavailable(): MacroMarketSnapshotView {
  return Object.freeze({ state: 'unavailable' as const })
}

export type MacroMarketSnapshotClient = ReturnType<typeof createMacroMarketSnapshotClient>
