import { isMarketCalendarPage, isMarketCalendarQuery, isMarketCalendarRefreshResult, isMarketCalendarScope,
  marketCalendarPublicPolicy, type MarketCalendarPage, type MarketCalendarQuery, type MarketCalendarRefreshResult,
  type MarketCalendarScope } from '../../../contracts/macro/marketCalendarQueryContracts'
export type MarketCalendarClient = {
  queryMonth: (input: MarketCalendarQuery) => Promise<MarketCalendarPage>
  refresh: (input: MarketCalendarScope) => Promise<MarketCalendarRefreshResult>
}
export const marketCalendarClient: MarketCalendarClient = {
  async queryMonth(input) {
    if (!isMarketCalendarQuery(input)) return { state: 'unavailable', failureCode: 'input-invalid' }
    const value = await invoke(marketCalendarPublicPolicy.methods.query, input)
    return isMarketCalendarPage(value, input) ? value : { state: 'unavailable', failureCode: 'query-unavailable' }
  },
  async refresh(input) {
    if (!isMarketCalendarScope(input)) return { state: 'unavailable', sources: [], failureCode: 'input-invalid' }
    const value = await invoke(marketCalendarPublicPolicy.methods.refresh, input)
    return isMarketCalendarRefreshResult(value) ? value : { state: 'unavailable', sources: [], failureCode: 'readiness-unavailable' }
  }
}
async function invoke(method: string, payload: unknown): Promise<unknown> {
  try { return await window.platform?.products?.invoke('market-intelligence', method, payload) } catch { return undefined }
}
