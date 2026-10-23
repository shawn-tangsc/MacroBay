import { capitalConditionsDailyFlowPolicy } from '../../../contracts/intelligenceQueryContracts'

export const coreStablecoinIdentityPolicy = Object.freeze({
  sourceId: 'defillama-stablecoins',
  assets: [
    { assetId: '1', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed' },
    { assetId: '2', symbol: 'USDC', pegType: 'peggedUSD', pegMechanism: 'fiat-backed' }
  ],
  usdPegType: 'peggedUSD',
  unavailableFailureCode: 'core-stablecoin-invalid'
} as const)

export const coreStablecoinWindowPolicy = Object.freeze({
  currentField: 'circulating',
  dayField: 'circulatingPrevDay',
  weekField: 'circulatingPrevWeek',
  monthField: 'circulatingPrevMonth',
  usdField: 'peggedUSD',
  maximumUsdValue: Number.MAX_SAFE_INTEGER
})

export type StablecoinDailyFlow = Readonly<{ tradingDate: string; netFlowUsd: number }>

export type StablecoinCapitalSnapshot = Readonly<{
  coreCurrentUsd: number
  change1dUsd: number
  change1dPercent: number
  change7dUsd: number
  change7dPercent: number
  change30dUsd: number
  change30dPercent: number
  usdStablecoinSupplyUsd?: number
  dailyFlows?: readonly StablecoinDailyFlow[]
}>

export type StablecoinCapitalParseResult =
  | Readonly<{ state: 'available'; snapshot: StablecoinCapitalSnapshot }>
  | Readonly<{ state: 'unavailable'; failureCode: typeof coreStablecoinIdentityPolicy.unavailableFailureCode }>

type AssetValues = Readonly<{ current: number; day: number; week: number; month: number }>

export function parseStablecoinCapitalSnapshot(payload: unknown): StablecoinCapitalParseResult {
  try {
    const assets = readAssets(payload)
    if (!assets) return unavailable()

    const core = coreStablecoinIdentityPolicy.assets.map((identity) => {
      const matches = assets.filter((asset) => readAssetId(asset) === identity.assetId)
      return matches.length === 1 && matchesIdentity(matches[0], identity) ? readCoreValues(matches[0]) : undefined
    })
    if (core.some((values) => !values)) return unavailable()

    const [usdt, usdc] = core as [AssetValues, AssetValues]
    const coreCurrentUsd = usdt.current + usdc.current
    const coreDayUsd = usdt.day + usdc.day
    const coreWeekUsd = usdt.week + usdc.week
    const coreMonthUsd = usdt.month + usdc.month
    if (!isPositiveUsd(coreWeekUsd) || !isPositiveUsd(coreMonthUsd) || !isValidUsd(coreCurrentUsd)) return unavailable()

    const change1dUsd = coreCurrentUsd - coreDayUsd
    const change7dUsd = coreCurrentUsd - coreWeekUsd
    const change1dPercent = change1dUsd / coreDayUsd * 100
    const change30dUsd = coreCurrentUsd - coreMonthUsd
    const change7dPercent = change7dUsd / coreWeekUsd * 100
    const change30dPercent = change30dUsd / coreMonthUsd * 100
    if (![change1dUsd, change1dPercent, change7dUsd, change30dUsd, change7dPercent, change30dPercent].every(Number.isFinite)) return unavailable()

    const usdStablecoinSupplyUsd = sumUsdBackground(assets)
    return Object.freeze({
      state: 'available' as const,
      snapshot: Object.freeze({
        coreCurrentUsd,
        change1dUsd,
        change1dPercent,
        change7dUsd,
        change7dPercent,
        change30dUsd,
        change30dPercent,
        ...(usdStablecoinSupplyUsd === undefined ? {} : { usdStablecoinSupplyUsd })
      })
    })
  } catch {
    return unavailable()
  }
}

export function parseStablecoinDailyHistory(payload: unknown, now: string): readonly StablecoinDailyFlow[] | undefined {
  try {
    if (!isCanonicalUtcMillis(now) || !Array.isArray(payload)) return undefined
    const currentDay = now.slice(0, 10)
    const rows = payload.map((value) => {
      const record = safeRecord(value)
      const date = record && readValue(record, 'date')
      const totals = record && safeRecord(readValue(record, 'totalCirculatingUSD'))
      const total = totals && readValue(totals, 'peggedUSD')
      if (!record || !totals || !isValidUsd(total) ||
        typeof date !== 'string' || !/^\d+$/.test(date)) return undefined
      const epochSeconds = Number(date)
      if (!Number.isSafeInteger(epochSeconds)) return undefined
      const instant = epochSeconds * 1_000
      const tradingDate = new Date(instant).toISOString().slice(0, 10)
      if (new Date(`${tradingDate}T00:00:00.000Z`).getTime() !== instant) return undefined
      return { tradingDate, total }
    })
    if (rows.some((row) => !row)) return undefined
    const parsedRows = rows as readonly { tradingDate: string; total: number }[]
    for (let index = 1; index < parsedRows.length; index += 1) {
      if (parsedRows[index - 1]!.tradingDate >= parsedRows[index]!.tradingDate) return undefined
    }
    if (parsedRows.some((row) => row.tradingDate > currentDay)) return undefined
    const complete = parsedRows.filter((row) => row.tradingDate < currentDay)
    if (complete.length < capitalConditionsDailyFlowPolicy.minimumRows) return undefined
    for (let index = 1; index < complete.length; index += 1) {
      const previous = complete[index - 1]!
      const current = complete[index]!
      if (previous.tradingDate >= current.tradingDate || Date.parse(`${current.tradingDate}T00:00:00.000Z`) - Date.parse(`${previous.tradingDate}T00:00:00.000Z`) !== capitalConditionsDailyFlowPolicy.dayMilliseconds) return undefined
    }
    const start = Math.max(0, complete.length - capitalConditionsDailyFlowPolicy.maximumRows)
    const selected = complete.slice(start)
    return Object.freeze(selected.map((row, index) => Object.freeze({
      tradingDate: row.tradingDate,
      netFlowUsd: row.total - (index === 0 ? (complete[start - 1]?.total ?? row.total) : selected[index - 1]!.total)
    })))
  } catch {
    return undefined
  }
}

function readAssets(payload: unknown): readonly Record<string, unknown>[] | undefined {
  const body = safeRecord(payload)
  const assets = body && readValue(body, 'peggedAssets')
  return Array.isArray(assets) && assets.every((asset) => safeRecord(asset))
    ? assets as readonly Record<string, unknown>[]
    : undefined
}

function matchesIdentity(asset: Record<string, unknown>, identity: typeof coreStablecoinIdentityPolicy.assets[number]): boolean {
  return readAssetId(asset) === identity.assetId &&
    readValue(asset, 'symbol') === identity.symbol &&
    readValue(asset, 'pegType') === identity.pegType &&
    readValue(asset, 'pegMechanism') === identity.pegMechanism
}

function readAssetId(asset: Record<string, unknown>): string | undefined {
  const id = readValue(asset, 'id')
  return (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) || (typeof id === 'string' && /^(?:0|[1-9][0-9]*)$/.test(id))
    ? String(id)
    : undefined
}

function readCoreValues(asset: Record<string, unknown>): AssetValues | undefined {
  const current = readPeggedUsd(asset, coreStablecoinWindowPolicy.currentField)
  const day = readPeggedUsd(asset, coreStablecoinWindowPolicy.dayField)
  const week = readPeggedUsd(asset, coreStablecoinWindowPolicy.weekField)
  const month = readPeggedUsd(asset, coreStablecoinWindowPolicy.monthField)
  return current === undefined || day === undefined || week === undefined || month === undefined
    ? undefined
    : Object.freeze({ current, day, week, month })
}

function readPeggedUsd(asset: Record<string, unknown>, field: string): number | undefined {
  const values = safeRecord(readValue(asset, field))
  const value = values && readValue(values, coreStablecoinWindowPolicy.usdField)
  return isValidUsd(value) ? value : undefined
}

function sumUsdBackground(assets: readonly Record<string, unknown>[]): number | undefined {
  let total = 0
  for (const asset of assets) {
    if (readValue(asset, 'pegType') !== coreStablecoinIdentityPolicy.usdPegType) continue
    const current = readPeggedUsd(asset, coreStablecoinWindowPolicy.currentField)
    if (current === undefined) continue
    total += current
    if (!isValidUsd(total)) return undefined
  }
  return total
}

function isValidUsd(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= coreStablecoinWindowPolicy.maximumUsdValue
}

function isPositiveUsd(value: unknown): value is number {
  return isValidUsd(value) && value > 0
}

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return undefined
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return undefined
    }
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined
}

function unavailable(): Extract<StablecoinCapitalParseResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable', failureCode: coreStablecoinIdentityPolicy.unavailableFailureCode })
}
