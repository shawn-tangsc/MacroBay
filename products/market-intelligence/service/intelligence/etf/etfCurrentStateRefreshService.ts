import { createHash } from 'node:crypto'

import type { EtfCurrentStateStore } from '../store/etfCurrentStateStore'
import { buildEtfCurrentStateWindow, etfCurrentStateWindowPolicy, type EtfAsset, type EtfDailyFlow } from './etfCurrentStateWindow'
import type { EtfFlowHistoryRow } from './etfFlowHistoryParser'

export const etfCurrentStateRefreshAdmissionPolicy = Object.freeze({
  unavailableState: 'unavailable' as const,
  sourceId: etfCurrentStateWindowPolicy.sourceId,
  updateMarkerDigestAlgorithm: 'sha256',
  currentUtcDate(now: string): string | undefined {
    return isCanonicalUtcMillis(now) ? now.slice(0, 10) : undefined
  }
})

type EtfWindowRequestResult =
  | Readonly<{ state: 'available'; btc: readonly EtfFlowHistoryRow[]; eth: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'partial'; btc?: readonly EtfFlowHistoryRow[]; eth?: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'unavailable' }>

export function createEtfCurrentStateRefreshService(deps: {
  isEnabled: () => Promise<boolean>
  hasCredential: () => Promise<boolean>
  requestWindow: () => Promise<EtfWindowRequestResult>
  store: Pick<EtfCurrentStateStore, 'replace'> & Partial<Pick<EtfCurrentStateStore, 'read'>>
  now: () => string
}) {
  return {
    async refresh(): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      if (!await enabled(deps.isEnabled) || !await enabled(deps.hasCredential)) return unavailable()
      const fetchedAt = deps.now()
      const currentUtcDate = etfCurrentStateRefreshAdmissionPolicy.currentUtcDate(fetchedAt)
      if (!currentUtcDate) return unavailable()
      try {
        const requested = await deps.requestWindow()
        if (requested.state === 'unavailable') return unavailable()
        const previous = requested.state === 'partial' && deps.store.read ? await deps.store.read() : null
        const btc = requested.state === 'partial' ? mergeRows(previous?.snapshot?.window.btc, requested.btc) : requested.btc
        const eth = requested.state === 'partial' ? mergeRows(previous?.snapshot?.window.eth, requested.eth) : requested.eth
        if (!btc || !eth) return unavailable()
        const built = buildWindow({ btc, eth, fetchedAt, currentUtcDate })
        return built ? deps.store.replace({ window: built, verifiedAt: fetchedAt }) : unavailable()
      } catch {
        return unavailable()
      }
    }
  }
}

async function enabled(read: () => Promise<boolean>): Promise<boolean> {
  try { return await read() } catch { return false }
}

function buildWindow(input: Readonly<{
  btc: readonly EtfFlowHistoryRow[]
  eth: readonly EtfFlowHistoryRow[]
  fetchedAt: string
  currentUtcDate: string
}>) {
  const btc = toFlows(input.btc, 'BTC', input.fetchedAt, input.currentUtcDate)
  const eth = toFlows(input.eth, 'ETH', input.fetchedAt, input.currentUtcDate)
  if (!btc || !eth) return undefined
  const completeDates = btc.map((flow) => flow.tradingDate)
    .filter((date) => eth.some((flow) => flow.tradingDate === date))
    .slice(-etfCurrentStateWindowPolicy.maximumRowsPerAsset)
  if (completeDates.length < etfCurrentStateWindowPolicy.minimumCompleteRows) return undefined
  const built = buildEtfCurrentStateWindow({
    asOf: input.fetchedAt,
    completeThrough: completeDates.at(-1)!,
    completeDates,
    btc: btc.filter((flow) => completeDates.includes(flow.tradingDate)),
    eth: eth.filter((flow) => completeDates.includes(flow.tradingDate))
  })
  if (built.state !== 'available') return undefined
  const revision = revisionFor([...built.window.btc, ...built.window.eth])
  return Object.freeze({ ...built.window, ...(revision ? { revision } : {}) })
}

function toFlows(rows: readonly EtfFlowHistoryRow[], asset: EtfAsset, fetchedAt: string, currentUtcDate: string): readonly EtfDailyFlow[] | undefined {
  const dates = new Set<string>()
  const flows: EtfDailyFlow[] = []
  for (const row of rows) {
    const tradingDate = utcTradingDate(row.date)
    if (!tradingDate || tradingDate > currentUtcDate || dates.has(tradingDate)) return undefined
    dates.add(tradingDate)
    if (tradingDate === currentUtcDate) continue
    flows.push(Object.freeze({
      asset, tradingDate, netFlowUsd: row.changeUsd,
      observedAt: `${tradingDate}T00:00:00.000Z`, fetchedAt,
      source: etfCurrentStateRefreshAdmissionPolicy.sourceId,
      ...(row.updateTime ? { sourceRevision: row.updateTime } : {})
    }))
  }
  return flows.sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
}

function mergeRows(previous: readonly EtfDailyFlow[] | undefined, incoming: readonly EtfFlowHistoryRow[] | undefined): readonly EtfFlowHistoryRow[] | undefined {
  if (!previous && !incoming) return undefined
  const byDate = new Map<number, EtfFlowHistoryRow>()
  for (const row of previous ?? []) byDate.set(Date.parse(`${row.tradingDate}T00:00:00.000Z`), { date: Date.parse(`${row.tradingDate}T00:00:00.000Z`), changeUsd: row.netFlowUsd, ...(row.sourceRevision ? { updateTime: row.sourceRevision } : {}) })
  for (const row of incoming ?? []) byDate.set(row.date, row)
  return [...byDate.values()].sort((left, right) => left.date - right.date)
}

function revisionFor(rows: readonly EtfDailyFlow[]): Readonly<{ providerCurrentStateId: string }> {
  return Object.freeze({
    providerCurrentStateId: createHash(etfCurrentStateRefreshAdmissionPolicy.updateMarkerDigestAlgorithm)
      .update(rows.map((row) => `${row.asset}:${row.tradingDate}:${row.netFlowUsd}:${row.sourceRevision ?? ''}`).join('|'))
      .digest('hex')
  })
}

function utcTradingDate(value: number): string | undefined {
  if (!Number.isSafeInteger(value)) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) return undefined
  return date.toISOString().slice(0, 10)
}

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function unavailable(): Readonly<{ state: 'unavailable' }> {
  return Object.freeze({ state: etfCurrentStateRefreshAdmissionPolicy.unavailableState })
}
