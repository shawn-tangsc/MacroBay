import { crossAssetMethods, parseCrossAssetInput, parseCrossAssetCommandResult, parseCrossAssetSnapshot, type CrossAssetQueryInput, type CrossAssetRejection, type CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
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
  async query(input: CrossAssetQueryInput): Promise<CrossAssetSnapshot | Readonly<{ state: 'unavailable'; cause: 'query' | 'contract'; field?: string }>> {
      let raw: unknown
      try {
        const safe = parseCrossAssetInput(crossAssetMethods.query, input, Date.now())
        if (!safe) return { state: 'unavailable', cause: 'query' }
        raw = await invoke('market-intelligence', crossAssetMethods.query, safe)
      } catch { return { state: 'unavailable', cause: 'query' } }
      /**
       * 主进程明确回「这次没读到」：那是**读失败**（`query`），界面说「行情暂不可用 + 再试一次」。
       * 只有**一份形状不对的快照**才算 `contract`（版本不一致）——那种才配说「重启应用」。
       * 2026-11-11 事故里两件事被混成一件：服务真产出的快照被自己的契约拒掉，界面却让读者重启，
       * 而主进程和界面是同一版代码，重启一百次也一样。
       */
      if (raw !== null && typeof raw === 'object' && (raw as { state?: unknown }).state === 'unavailable' &&
        Object.keys(raw as Record<string, unknown>).length === 1) {
        return { state: 'unavailable', cause: 'query' }
      }
      try {
        const rejection: CrossAssetRejection = {}
        const result = parseCrossAssetSnapshot(raw, rejection)
        if (!result) {
          // 拒在哪一字段：不带出来，下一次还得靠人临时搓探针。
          console.warn('[cross-asset] snapshot rejected by the contract at', rejection.field ?? 'unknown')
          return { state: 'unavailable', cause: 'contract', ...(rejection.field === undefined ? {} : { field: rejection.field }) }
        }
        if (result.range !== input.range || (input.asOf ? result.mode !== 'historical' || result.asOf !== input.asOf : result.mode !== 'current')) {
          console.warn('[cross-asset] snapshot answered a different window than the one asked for')
          return { state: 'unavailable', cause: 'contract', field: 'range' }
        }
        return result
      } catch { return { state: 'unavailable', cause: 'contract' } }
    }
  }
}
