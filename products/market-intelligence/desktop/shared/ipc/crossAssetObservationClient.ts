import { crossAssetMethods, parseCrossAssetInput, parseCrossAssetCommandResult, parseCrossAssetSnapshot, type CrossAssetQueryInput, type CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
export function createCrossAssetObservationClient(invoke: (productId: string, method: string, payload: unknown) => Promise<unknown> =
  (productId, method, payload) => window.platform.products.invoke(productId, method, payload)) {
  const unavailable = () => ({ state: 'unavailable' as const })
  async function command(key: Exclude<keyof typeof crossAssetMethods, 'query'>, payload: unknown = {}) {
    try {
      const input = parseCrossAssetInput(crossAssetMethods[key], payload, Date.now())
      if (!input) return unavailable()
      return parseCrossAssetCommandResult(key, await invoke('market-intelligence', crossAssetMethods[key], input), Date.now()) ?? unavailable()
    } catch { return unavailable() }
  }
  return {
    acquire: () => command('acquire'), renew: (leaseId: string) => command('renew', { leaseId }),
    release: (leaseId: string) => command('release', { leaseId }), refresh: (leaseId: string) => command('refresh', { leaseId }),
    getSourceConfiguration: () => command('getSourceConfiguration'), testInterface: () => command('testInterface'),
    cancelInterfaceTest: () => command('cancelInterfaceTest'),
    /**
   * A snapshot the renderer cannot parse is **not** the same failure as a query that did not answer:
   * the first means the main process runs a different contract (`contract`), the second is a real
   * read failure (`query`). The panel needs the difference — one is fixed by restarting, the other by
   * retrying — so the outcome says which.
   */
  async query(input: CrossAssetQueryInput): Promise<CrossAssetSnapshot | Readonly<{ state: 'unavailable'; cause: 'query' | 'contract' }>> {
      let raw: unknown
      try {
        const safe = parseCrossAssetInput(crossAssetMethods.query, input, Date.now())
        if (!safe) return { state: 'unavailable', cause: 'query' }
        raw = await invoke('market-intelligence', crossAssetMethods.query, safe)
      } catch { return { state: 'unavailable', cause: 'query' } }
      try {
        const result = parseCrossAssetSnapshot(raw)
        return result && result.range === input.range && (input.asOf ? result.mode === 'historical' && result.asOf === input.asOf : result.mode === 'current')
          ? result
          : { state: 'unavailable', cause: 'contract' }
      } catch { return { state: 'unavailable', cause: 'contract' } }
    }
  }
}
