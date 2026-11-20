import { etfCurrentStateWindowPolicy, etfWindowRevision, etfWindowSource, isValidEtfCurrentStateWindow, type EtfCurrentStateWindow, type EtfDailyFlow, type EtfFlowSourceId } from '../etf/etfCurrentStateWindow'
import { etfPublicSnapshotPolicy } from '../../../contracts/intelligenceQueryContracts'

/**
 * ETF 当前状态的**形状、策略、迁移与校验**。
 *
 * 从 `etfCurrentStateStore` 抽出来的唯一理由：那个文件越过 500 行硬线，而"库"与"schema"本来就是两件职责
 * ——读侧（存储解码）与写侧（落盘前校验）都只依赖这一份，抽出来谁都不用多知道对方。
 * 行为一字未改：同一份策略、同一段迁移、同一组校验，键与边界都没动。
 */
export const etfCurrentStateStorePolicy = Object.freeze({
  schemaVersion: 2,
  // 12KB 在旧 id 下已占 98.7%（30 行 12,129 字节）；新 id 每行更长，满窗会越过上限，
  // 那会让 persist 静默返回 false、读数永远写不进去。16KB 留出余量，并由用例钉住。
  maximumWindowBytes: 16 * 1024,
  maximumStateBytes: 256 * 1024,
  maximumAtomicDiskBytes: 512 * 1024,
  maximumSnapshotAgeMs: etfPublicSnapshotPolicy.maximumAgeMs,
  maximumCounter: Number.MAX_SAFE_INTEGER,
  // A cutoff is answered from the rows the provider had observed by then, and the current window
  // is replaced on every refresh, so keeping only that window loses the cutoff the moment a refresh
  // lands after it. Each refresh archives its own row set by age: every refresh inside the dense
  // span, one per hour past it. The physical horizon is the coverage plus one thinning bucket,
  // because bucket thinning keeps a bucket's latest point. The archive stores only the material row
  // fields, which keeps its entries several times smaller than the state budget.
  historyCoverageMs: 30 * 60 * 60 * 1_000,
  historyDenseMs: 2 * 60 * 60 * 1_000,
  historyDenseMaximumEntries: 16,
  maximumHistoryEntries: 48,
  historyThinningMs: 60 * 60 * 1_000,
  historyByteBudget: 256 * 1024 - 24 * 1024
})

export type EtfCurrentStateHealth = Readonly<{
  lastAttemptAt: string
  lastSuccessAt?: string
  snapshotReplaceCount: number
  snapshotNoWriteCount: number
  rejectionCount: number
}>

/** One material flow row: trading date, net flow, and the instant the provider had it. */
export type EtfHistoryRow = readonly [tradingDate: string, netFlowUsd: number, observedAt: string]

/** The rows a refresh stored, kept so a cutoff can be answered after the window moved on. */
export type EtfCurrentStateHistoryEntry = Readonly<{
  at: string
  /** 这份归档行自己的来源。v1 没有它，迁移时按当时的窗口来源补上；没有它归档会被整片重标。 */
  source: EtfFlowSourceId
  btc: readonly EtfHistoryRow[]
  eth: readonly EtfHistoryRow[]
}>

export type EtfCurrentState = Readonly<{
  schemaVersion: typeof etfCurrentStateStorePolicy.schemaVersion
  snapshot?: Readonly<{ window: EtfCurrentStateWindow; verifiedAt: string }>
  history?: readonly EtfCurrentStateHistoryEntry[]
  health: EtfCurrentStateHealth
}>

export type EtfCurrentStateStorage = {
  read: () => Promise<EtfCurrentState | null>
  write: (state: EtfCurrentState) => Promise<void>
}

export function isValidEtfCurrentState(state: unknown): state is EtfCurrentState {
  if (!isPlainRecord(state) || !hasOnlyKeys(state, ['schemaVersion', 'snapshot', 'history', 'health']) || state.schemaVersion !== etfCurrentStateStorePolicy.schemaVersion || !isHealth(state.health)) return false
  if (state.history !== undefined && !isHistory(state.history)) return false
  if (state.snapshot === undefined) return true
  if (!isPlainRecord(state.snapshot) || !hasOnlyKeys(state.snapshot, ['window', 'verifiedAt']) || !isCanonicalUtcMillis(state.snapshot.verifiedAt) || !isCanonicalWindow(state.snapshot.window as EtfCurrentStateWindow)) return false
  return isSafeState(state as EtfCurrentState)
}

/**
 * v1 → v2，**只读内存、不写回**，在存储解码处校验之前跑（R1）。同一输入两次输出一致。
 *
 * - 每条归档行集补自己的 `source`：v1 只可能写过 `'0xrouter'`，所以补旧值即正确（R2）。
 * - 没有 revision 的窗口补一个确定性摘要，否则 `replace` 的闸门恒 false、换源永远写不进去（R4）。
 * - 允许集是新旧两个 id：旧行迁移后仍是 `'0xrouter'`，只留新 id 会把旧窗口判非法（R3）。
 */
export function migrateEtfCurrentState(value: unknown): EtfCurrentState | undefined {
  if (!isPlainRecord(value)) return undefined
  if (value.schemaVersion === etfCurrentStateStorePolicy.schemaVersion) {
    return isValidEtfCurrentState(value) ? value as EtfCurrentState : undefined
  }
  if (value.schemaVersion !== 1 || !isHealth(value.health)) return undefined

  const snapshot = value.snapshot
  let migratedSnapshot: EtfCurrentState['snapshot']
  if (snapshot !== undefined) {
    if (!isPlainRecord(snapshot) || !hasOnlyKeys(snapshot, ['window', 'verifiedAt']) || !isCanonicalUtcMillis(snapshot.verifiedAt)) return undefined
    const window = migrateWindow(snapshot.window)
    if (!window) return undefined
    migratedSnapshot = Object.freeze({ window, verifiedAt: snapshot.verifiedAt })
  }

  let migratedHistory: readonly EtfCurrentStateHistoryEntry[] | undefined
  if (value.history !== undefined) {
    if (!Array.isArray(value.history)) return undefined
    const windowSource = migratedSnapshot ? etfWindowSource(migratedSnapshot.window) : etfCurrentStateWindowPolicy.legacySourceId
    const entries: EtfCurrentStateHistoryEntry[] = []
    for (const entry of value.history) {
      if (!isPlainRecord(entry) || !hasOnlyKeys(entry, ['at', 'source', 'btc', 'eth']) || !isCanonicalUtcMillis(entry.at)) return undefined
      const own = (etfCurrentStateWindowPolicy.allowedSourceIds as readonly string[]).includes(entry.source as string)
        ? entry.source as EtfFlowSourceId
        : windowSource
      entries.push(Object.freeze({ at: entry.at, source: own, btc: entry.btc as readonly EtfHistoryRow[], eth: entry.eth as readonly EtfHistoryRow[] }))
    }
    migratedHistory = Object.freeze(entries)
  }

  const migrated = Object.freeze({
    schemaVersion: etfCurrentStateStorePolicy.schemaVersion,
    ...(migratedSnapshot ? { snapshot: migratedSnapshot } : {}),
    ...(migratedHistory ? { history: migratedHistory } : {}),
    health: value.health
  }) as EtfCurrentState
  return isValidEtfCurrentState(migrated) ? migrated : undefined
}

function migrateWindow(value: unknown): EtfCurrentStateWindow | undefined {
  if (!isPlainRecord(value)) return undefined
  const btc = migrateRows(value.btc)
  const eth = migrateRows(value.eth)
  if (!btc || !eth) return undefined
  const revision = isSafeRevisionIdentity(value.revision as EtfCurrentStateWindow['revision']) && value.revision !== undefined
    ? value.revision as EtfCurrentStateWindow['revision']
    : etfWindowRevision([...btc, ...eth])
  const candidate: EtfCurrentStateWindow = {
    btc, eth,
    windowEnd: value.windowEnd as string,
    capitalConclusionDates: value.capitalConclusionDates as readonly string[],
    revision
  }
  return isValidEtfCurrentStateWindow(candidate) ? Object.freeze(candidate) : undefined
}

function migrateRows(value: unknown): readonly EtfDailyFlow[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((row) => {
    if (!isPlainRecord(row)) return row as never
    const source = (etfCurrentStateWindowPolicy.allowedSourceIds as readonly string[]).includes(row.source as string)
      ? row.source as EtfFlowSourceId
      : etfCurrentStateWindowPolicy.legacySourceId
    return Object.freeze({ ...(row as unknown as EtfDailyFlow), source })
  }) as readonly EtfDailyFlow[]
}

export function windowFromHistoryEntry(entry: EtfCurrentStateHistoryEntry): EtfCurrentStateWindow | undefined {
  const flows = (rows: readonly EtfHistoryRow[], asset: 'BTC' | 'ETH'): readonly EtfDailyFlow[] =>
    rows.map(([tradingDate, netFlowUsd, observedAt]) => Object.freeze({
      asset, tradingDate, netFlowUsd, observedAt, fetchedAt: entry.at, source: entry.source
    }))
  const btc = flows(entry.btc, 'BTC')
  const eth = flows(entry.eth, 'ETH')
  const windowEnd = btc.at(-1)?.tradingDate
  if (!windowEnd) return undefined
  const window = Object.freeze({
    btc: Object.freeze(btc),
    eth: Object.freeze(eth),
    windowEnd,
    capitalConclusionDates: Object.freeze(btc.slice(-etfCurrentStateWindowPolicy.capitalConclusionRows).map((flow) => flow.tradingDate))
  })
  return isValidEtfCurrentStateWindow(window) ? window : undefined
}

export function isCanonicalWindow(window: EtfCurrentStateWindow): boolean {
  return isValidEtfCurrentStateWindow(window) && isSafeRevisionIdentity(window.revision)
}

function isSafeRevisionIdentity(value: EtfCurrentStateWindow['revision']): boolean {
  return value === undefined || (Object.keys(value).length === 1 && typeof value.providerCurrentStateId === 'string' && value.providerCurrentStateId.length > 0 && value.providerCurrentStateId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value.providerCurrentStateId))
}

export function isSafeState(state: EtfCurrentState): boolean {
  const windowBytes = state.snapshot ? Buffer.byteLength(JSON.stringify(state.snapshot.window), 'utf8') : 0
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
  return state.schemaVersion === etfCurrentStateStorePolicy.schemaVersion && windowBytes <= etfCurrentStateStorePolicy.maximumWindowBytes && stateBytes <= etfCurrentStateStorePolicy.maximumStateBytes && stateBytes * 2 <= etfCurrentStateStorePolicy.maximumAtomicDiskBytes
}

function isHealth(value: unknown): value is EtfCurrentStateHealth {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['lastAttemptAt', 'lastSuccessAt', 'snapshotReplaceCount', 'snapshotNoWriteCount', 'rejectionCount'])) return false
  return isCanonicalUtcMillis(value.lastAttemptAt) && (value.lastSuccessAt === undefined || isCanonicalUtcMillis(value.lastSuccessAt)) &&
    [value.snapshotReplaceCount, value.snapshotNoWriteCount, value.rejectionCount].every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= etfCurrentStateStorePolicy.maximumCounter)
}

function isHistory(value: unknown): value is readonly EtfCurrentStateHistoryEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > etfCurrentStateStorePolicy.maximumHistoryEntries) return false
  let previous = ''
  for (const entry of value) {
    if (!isPlainRecord(entry) || !hasOnlyKeys(entry, ['at', 'source', 'btc', 'eth']) || !isCanonicalUtcMillis(entry.at) || entry.at <= previous) return false
    if (!(etfCurrentStateWindowPolicy.allowedSourceIds as readonly string[]).includes(entry.source as string)) return false
    if (!isHistoryRows(entry.btc) || !isHistoryRows(entry.eth)) return false
    if (!windowFromHistoryEntry(entry as unknown as EtfCurrentStateHistoryEntry)) return false
    previous = entry.at
  }
  return true
}


function isHistoryRows(value: unknown): value is readonly EtfHistoryRow[] {
  return Array.isArray(value) && value.length >= etfCurrentStateWindowPolicy.minimumCompleteRows && value.length <= etfCurrentStateWindowPolicy.maximumRowsPerAsset &&
    value.every((row) => Array.isArray(row) && row.length === 3 && isTradingDate(row[0]) &&
      typeof row[1] === 'number' && Number.isFinite(row[1]) && Math.abs(row[1]) <= etfCurrentStateWindowPolicy.maximumAbsoluteUsdFlow &&
      isCanonicalUtcMillis(row[2]))
}

function isTradingDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function emptyState(): EtfCurrentState {
  return Object.freeze({
    schemaVersion: etfCurrentStateStorePolicy.schemaVersion,
    health: Object.freeze({ lastAttemptAt: '1970-01-01T00:00:00.000Z', snapshotReplaceCount: 0, snapshotNoWriteCount: 0, rejectionCount: 0 })
  })
}

function increment(value: number, shouldIncrement: boolean): number {
  return shouldIncrement ? Math.min(value + 1, etfCurrentStateStorePolicy.maximumCounter) : value
}

export function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
