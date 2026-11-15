import { isMarketCalendarFreshness, isMarketCalendarPage, isMarketCalendarQuery, isMarketCalendarRefreshNowResult,
  isMarketCalendarRefreshResult, isMarketCalendarScope, marketCalendarPublicPolicy, type MarketCalendarFreshness,
  type MarketCalendarPage, type MarketCalendarQuery, type MarketCalendarRefreshNowResult,
  type MarketCalendarRefreshResult, type MarketCalendarScope } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { UnmappedCalendarObservation } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
export type MarketCalendarClient = {
  queryMonth: (input: MarketCalendarQuery) => Promise<MarketCalendarPage>
  refresh: (input: MarketCalendarScope) => Promise<MarketCalendarRefreshResult>
  /** How old the calendar actually is; `unavailable` means "cannot tell", never "nothing". */
  getCollectionFreshness: () => Promise<MarketCalendarFreshness>
  /**
   * 未映射观测（进不了标准表的那批）的月读：**渲染专用，不进简报、不进 AI 分析**。
   *
   * 出参必须能分清「读到空」和「读不到」——`state: 'unavailable'` 是后者，**不许拿空数组顶替**。
   */
  queryUnmappedMonth: (input: Readonly<{ month: string; locale: 'zh-CN' | 'en-US' }>) => Promise<UnmappedMonthView>
  /** Bounded catch-up: `timeout` is its own answer and is never reported as a failure. */
  refreshNow: (input: Readonly<{ sourceIds?: readonly string[]; timeoutMs?: number }>) => Promise<MarketCalendarRefreshNowResult>
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
  },
  async getCollectionFreshness() {
    const value = await invoke(marketCalendarPublicPolicy.methods.getCollectionFreshness, {})
    return isMarketCalendarFreshness(value) ? value : { state: 'unavailable', failureCode: 'query-unavailable' }
  },
  async queryUnmappedMonth(input) {
    const value = await invoke(marketCalendarPublicPolicy.methods.queryUnmappedMonth, { month: input.month, locale: input.locale })
    return unmappedMonthViewOf(value)
  },
  async refreshNow(input) {
    const value = await invoke(marketCalendarPublicPolicy.methods.refreshNow, input)
    return isMarketCalendarRefreshNowResult(value) ? value : { state: 'failed', failureCode: 'readiness-unavailable' }
  }
}
export type UnmappedMonthView =
  | Readonly<{ state: 'available'; items: readonly UnmappedCalendarObservation[]; undated: number; superseded: number }>
  | Readonly<{ state: 'unavailable' }>

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try { return await window.platform?.products?.invoke('market-intelligence', method, payload) } catch { return undefined }
}

/**
 * IPC 回来的一律当 `unknown`：形状不合就判「读不到」，**不许放行半条**给列表——
 * 一条残行会变成一条编出来的日程。`entries` 的类型与读口一致，这里只做运行时校验。
 */
export function unmappedMonthViewOf(value: unknown): UnmappedMonthView {
  if (value === null || typeof value !== 'object') return { state: 'unavailable' }
  const record = value as Record<string, unknown>
  if (record.state !== 'available' || !Array.isArray(record.items)) return { state: 'unavailable' }
  const items: UnmappedCalendarObservation[] = []
  for (const entry of record.items) {
    if (entry === null || typeof entry !== 'object') return { state: 'unavailable' }
    const row = entry as Record<string, unknown>
    if (typeof row.key !== 'string' || row.key === '') return { state: 'unavailable' }
    if (typeof row.providerId !== 'string' || typeof row.sourceKey !== 'string') return { state: 'unavailable' }
    if (typeof row.scheduledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.scheduledDate)) return { state: 'unavailable' }
    if (row.timePrecision !== 'minute' && row.timePrecision !== 'date') return { state: 'unavailable' }
    if (row.timePrecision === 'minute' && (typeof row.scheduledAt !== 'string' || !Number.isFinite(Date.parse(row.scheduledAt)))) return { state: 'unavailable' }
    if (typeof row.title !== 'string' || row.title === '') return { state: 'unavailable' }
    if (row.countryCode !== undefined && typeof row.countryCode !== 'string') return { state: 'unavailable' }
    if (typeof row.reason !== 'string' || typeof row.detectedAt !== 'string') return { state: 'unavailable' }
    items.push(row as unknown as UnmappedCalendarObservation)
  }
  return {
    state: 'available',
    items,
    undated: typeof record.undated === 'number' ? record.undated : 0,
    superseded: typeof record.superseded === 'number' ? record.superseded : 0
  }
}
