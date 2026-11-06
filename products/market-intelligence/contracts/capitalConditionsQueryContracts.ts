/**
 * Capital-conditions query contracts: the two DTOs, their policies and the validators that parse them.
 *
 * These left `intelligenceQueryContracts` when that barrel crossed its size budget. They are re-exported
 * from there, so consumers still import one module; here they sit next to the shapes they validate
 * (`capitalConditionsQueryTypes`).
 */

// The stale window is the renderer's own constant, imported rather than copied: two copies would let
// the contract call a snapshot valid while the row prints it as stale.
import { marketPulsePolicy } from './marketPulse'
import { isWithinUtf8JsonBudget } from './queryDtoBudget'
import type {
  EtfPublicAssetSnapshot,
  EtfPublicSnapshot
} from './capitalConditionsQueryTypes'

export const capitalConditionsSnapshotPolicy = {
  sourceId: 'defillama-stablecoins',
  maximumAgeMs: 6 * 60 * 60 * 1_000,
  maximumDtoBytes: 12 * 1024,
  unavailableFailureCode: 'capital-conditions-query-unavailable',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export const capitalConditionsDailyFlowPolicy = {
  /**
   * Chart rule only: below this many aligned days the chart is not drawn. It is **not** a
   * validity rule — a source that returns one to four days is delivering real data, and the
   * card says how many days it has instead of calling the whole reading a failure.
   */
  minimumChartRows: 5,
  maximumRows: 30,
  dayMilliseconds: 24 * 60 * 60 * 1_000,
  tradingDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const

export function isValidCapitalConditionsDailyFlows(value: unknown, asOf: unknown): value is readonly { tradingDate: string; netFlowUsd: number }[] {
  if (!Array.isArray(value) || value.length > capitalConditionsDailyFlowPolicy.maximumRows || !isCanonicalCapitalConditionsSnapshotTime(asOf)) return false
  const currentDate = asOf.slice(0, 10)
  return value.every((row, index) => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ['tradingDate', 'netFlowUsd']) || !isTradingDate(row.tradingDate) || row.tradingDate >= currentDate ||
      typeof row.netFlowUsd !== 'number' || !Number.isFinite(row.netFlowUsd) || Object.is(row.netFlowUsd, -0)) return false
    return index === 0 || Date.parse(`${row.tradingDate}T00:00:00.000Z`) - Date.parse(`${value[index - 1]!.tradingDate}T00:00:00.000Z`) === capitalConditionsDailyFlowPolicy.dayMilliseconds
  })
}

/** The complete capital-conditions result crosses service, IPC, and renderer boundaries. */
export function isWithinCapitalConditionsSnapshotDtoBudget(value: unknown): boolean {
  return isWithinUtf8JsonBudget(value, capitalConditionsSnapshotPolicy.maximumDtoBytes)
}

export const etfPublicSnapshotPolicy = {
  schemaVersion: 1,
  sourceId: '0xrouter',
  maximumAgeMs: 48 * 60 * 60 * 1_000,
  maximumRowsPerAsset: 30,
  minimumRowsPerAsset: 5,
  maximumDtoBytes: 12 * 1024,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  tradingDatePattern: /^\d{4}-\d{2}-\d{2}$/
} as const

export function isWithinEtfPublicSnapshotDtoBudget(value: unknown): boolean {
  return isWithinUtf8JsonBudget(value, etfPublicSnapshotPolicy.maximumDtoBytes)
}

export function isValidEtfPublicSnapshot(value: unknown): value is EtfPublicSnapshot {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, ['state', 'schemaVersion', 'sourceId', 'windowEnd', 'verifiedAt', 'btc', 'eth']) ||
      value.state !== 'available' || value.schemaVersion !== etfPublicSnapshotPolicy.schemaVersion || value.sourceId !== etfPublicSnapshotPolicy.sourceId ||
      !isTradingDate(value.windowEnd) || !isCanonicalEtfPublicTime(value.verifiedAt)) return false
    if (!isEtfPublicAsset(value.btc, 'BTC', value.verifiedAt) || !isEtfPublicAsset(value.eth, 'ETH', value.verifiedAt)) return false
    const btc = value.btc as EtfPublicAssetSnapshot
    const eth = value.eth as EtfPublicAssetSnapshot
    /**
     * The two ETFs are separate products with separate reporting schedules: ETH's newest trading day is
     * routinely one behind BTC's. Requiring both series to end on `windowEnd` therefore refused the whole
     * snapshot on an ordinary day — and both cells went blank, so one product's lag erased the other's
     * number too. A lag is a schedule, not a contract error: each asset's own age decides "stale" further
     * down (`etfStaleAfterMs`), where a stale row still prints the flow it has.
     *
     * Four things stay contract errors, and each of them can be made to fail:
     *
     * - a series running past the window end (a row that has not happened yet);
     * - a last row older than the stale window, measured with the renderer's own constant. Dropping the
     *   equal-endpoint rule must not swing from "too strict" to "too loose": without a floor, a snapshot
     *   from a month ago passes. One constant, because two copies drift into "valid but stale";
     * - a pair with no shared trading day inside the window: never comparable, so nothing to show;
     * - rows of the two series disagreeing on the days they do share (the order check below).
     */
    // Narrowed where the header guard proved it: `isTradingDate(value.windowEnd)` ran above.
    const windowEnd = value.windowEnd as string
    const dayOf = (tradingDate: string): number => Date.parse(`${tradingDate}T00:00:00.000Z`)
    const pastWindow = (asset: EtfPublicAssetSnapshot): boolean => (asset.rows.at(-1)?.tradingDate ?? '') > windowEnd
    if (pastWindow(btc) || pastWindow(eth)) return false
    const tooOld = (asset: EtfPublicAssetSnapshot): boolean => {
      const last = asset.rows.at(-1)?.tradingDate
      return last === undefined || dayOf(windowEnd) - dayOf(last) > marketPulsePolicy.etfStaleAfterMs
    }
    if (tooOld(btc) || tooOld(eth)) return false
    const ethDates = new Set(eth.rows.map((row) => row.tradingDate))
    const btcDates = new Set(btc.rows.map((row) => row.tradingDate))
    // The days the two actually share must line up one for one. Each series is already strictly
    // increasing per asset, so this cannot fail today; it is written out because removing that per-asset
    // check must not make a misaligned pair look aligned.
    const shared = (rows: readonly { tradingDate: string }[], other: Set<string>): readonly string[] =>
      rows.filter((row) => other.has(row.tradingDate)).map((row) => row.tradingDate)
    const btcShared = shared(btc.rows, ethDates)
    const ethShared = shared(eth.rows, btcDates)
    if (btcShared.length === 0 || btcShared.length !== ethShared.length || btcShared.some((date, index) => date !== ethShared[index])) return false
    return isWithinEtfPublicSnapshotDtoBudget(value)
  } catch {
    return false
  }
}

export function toEtfPublicSnapshot(value: unknown): EtfPublicSnapshot | undefined {
  if (!isValidEtfPublicSnapshot(value)) return undefined
  return Object.freeze({
    state: 'available', schemaVersion: etfPublicSnapshotPolicy.schemaVersion, sourceId: etfPublicSnapshotPolicy.sourceId,
    windowEnd: value.windowEnd, verifiedAt: value.verifiedAt,
    btc: copyEtfPublicAsset(value.btc), eth: copyEtfPublicAsset(value.eth)
  })
}

export function isCanonicalEtfPublicTime(value: unknown): value is string {
  if (typeof value !== 'string' || !etfPublicSnapshotPolicy.canonicalUtcMillisPattern.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}

export function isVisibleEtfPublicSnapshot(value: unknown, asOf: unknown): value is EtfPublicSnapshot {
  if (!isValidEtfPublicSnapshot(value) || !isCanonicalEtfPublicTime(asOf)) return false
  const ageMs = Date.parse(asOf) - Date.parse(value.verifiedAt)
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= etfPublicSnapshotPolicy.maximumAgeMs
}

function isEtfPublicAsset(value: unknown, asset: 'BTC' | 'ETH', verifiedAt: string): value is EtfPublicAssetSnapshot {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['asset', 'rows']) || value.asset !== asset || !Array.isArray(value.rows) ||
    value.rows.length < etfPublicSnapshotPolicy.minimumRowsPerAsset || value.rows.length > etfPublicSnapshotPolicy.maximumRowsPerAsset) return false
  const rows = value.rows as readonly unknown[]
  if (Object.keys(rows).length !== rows.length || Object.getOwnPropertySymbols(rows).length > 0) return false
  return rows.every((row, index) => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ['tradingDate', 'netFlowUsd', 'observedAt']) || !isTradingDate(row.tradingDate) ||
      typeof row.netFlowUsd !== 'number' || !Number.isFinite(row.netFlowUsd) || Object.is(row.netFlowUsd, -0) || !isCanonicalEtfPublicTime(row.observedAt) ||
      index > 0 && previousTradingDate(rows[index - 1]) >= row.tradingDate) return false
    return row.observedAt <= verifiedAt
  })
}

function copyEtfPublicAsset(value: EtfPublicAssetSnapshot): EtfPublicAssetSnapshot {
  return Object.freeze({
    asset: value.asset,
    rows: Object.freeze(value.rows.map((row) => Object.freeze({
      tradingDate: row.tradingDate, netFlowUsd: row.netFlowUsd, observedAt: row.observedAt
    })))
  })
}

function previousTradingDate(value: unknown): string {
  return isPlainRecord(value) && typeof value.tradingDate === 'string' ? value.tradingDate : ''
}

function isTradingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !etfPublicSnapshotPolicy.tradingDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.getOwnPropertySymbols(value).length === 0 && Object.keys(value).length === allowed.length && allowed.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}


export function isCanonicalCapitalConditionsSnapshotTime(value: unknown): value is string {
  if (typeof value !== 'string' || !capitalConditionsSnapshotPolicy.canonicalUtcMillisPattern.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}
