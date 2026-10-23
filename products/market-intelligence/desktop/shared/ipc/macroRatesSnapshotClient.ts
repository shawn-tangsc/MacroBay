import {
  macroRatesSnapshotPublicPolicy,
  parseMacroRatesSnapshot,
  type MacroRatesSnapshotView
} from '../../../contracts/macro/macroRatesSnapshotContracts'

/**
 * The renderer's read of the dashboard's daily FRED rate rows. The request carries no arguments; the
 * answer is re-validated on arrival with the same parser the main process ran, so a malformed payload
 * reads as 未接入 rather than as a figure.
 */
export function createMacroRatesSnapshotClient(invoke: (productId: string, method: string, payload: unknown) => Promise<unknown> =
  (productId, method, payload) => window.platform.products.invoke(productId, method, payload)) {
  return {
    async query(): Promise<MacroRatesSnapshotView> {
      try {
        const result = await invoke('market-intelligence', macroRatesSnapshotPublicPolicy.method, {})
        return parseMacroRatesSnapshot(result) ?? unavailable()
      } catch { return unavailable() }
    }
  }
}

function unavailable(): MacroRatesSnapshotView {
  return Object.freeze({ state: 'unavailable' as const })
}

export type MacroRatesSnapshotClient = ReturnType<typeof createMacroRatesSnapshotClient>
