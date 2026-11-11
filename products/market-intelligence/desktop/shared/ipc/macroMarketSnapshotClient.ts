import {
  macroMarketSnapshotPublicPolicy,
  parseMacroMarketSnapshot,
  type MacroMarketSnapshotQuery,
  type MacroMarketSnapshotView
} from '../../../contracts/macro/macroMarketSnapshotContracts'

/** 请求最多带一个「美元格选了哪个源」；答案到达时再校验一次，永远不信任。 */
export function createMacroMarketSnapshotClient(invoke: (productId: string, method: string, payload: unknown) => Promise<unknown> =
  (productId, method, payload) => window.platform.products.invoke(productId, method, payload)) {
  return {
    async query(input: MacroMarketSnapshotQuery = {}): Promise<MacroMarketSnapshotView> {
      try {
        const result = await invoke('market-intelligence', macroMarketSnapshotPublicPolicy.method, input)
        return parseMacroMarketSnapshot(result) ?? unavailable()
      } catch { return unavailable() }
    }
  }
}

function unavailable(): MacroMarketSnapshotView {
  return Object.freeze({ state: 'unavailable' as const })
}

export type MacroMarketSnapshotClient = ReturnType<typeof createMacroMarketSnapshotClient>
