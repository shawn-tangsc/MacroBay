import { crossAssetMethods, parseCrossAssetInput, parseCrossAssetCommandResult, parseCrossAssetSnapshot, type CrossAssetQueryInput } from '../../../contracts/crossAssetObservationContracts'
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
    async query(input: CrossAssetQueryInput) {
      try {
        const safe = parseCrossAssetInput(crossAssetMethods.query, input, Date.now())
        if (!safe) return unavailable()
        const result = parseCrossAssetSnapshot(await invoke('market-intelligence', crossAssetMethods.query, safe))
        return result && result.range === input.range && (input.asOf ? result.mode === 'historical' && result.asOf === input.asOf : result.mode === 'current') ? result : unavailable()
      } catch { return unavailable() }
    }
  }
}
