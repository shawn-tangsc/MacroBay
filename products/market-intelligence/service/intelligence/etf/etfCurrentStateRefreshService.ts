import type { FactSourceResolution } from '../../../contracts/factSources'
import type { EtfCurrentStateStore } from '../store/etfCurrentStateStore'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { buildEtfOutflowSignal } from '../signals/etfOutflowSignal'
import { reportSettledEtfRevisions } from './etfSettledRevision'
import { buildEtfCurrentStateWindow, etfCurrentStateWindowPolicy, etfWindowRevision, etfWindowSource, etfWindowSourceIdFor, type EtfAsset, type EtfCurrentStateWindow, type EtfDailyFlow, type EtfFlowSourceId } from './etfCurrentStateWindow'
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
  /**
   * 每轮现算「谁在供 etf-net-flow」：声明了、读者开着、作业真的注册着、且就绪的那个源。
   * 不许在启动时算一次缓存起来——排期是异步注册的，早于排期的那几轮会误判成 none。
   */
  resolveFactSource: () => Promise<FactSourceResolution>
  /** 按**解析出来的那个源**问开关与凭据（备源有它自己的一把 key）。 */
  isEnabled: (sourceId: string) => Promise<boolean>
  hasCredential: (sourceId: string) => Promise<boolean>
  /**
   * 按**解析出来的那个源**取窗口（主源不可用时解析器会给出备源）。
   * 参数是解析器给出的**注册表 id**：客户端按 id 选，行上的来源由装配处用窗口 id 盖。
   */
  requestWindow: (sourceId: string) => Promise<EtfWindowRequestResult>
  store: Pick<EtfCurrentStateStore, 'replace'> & Partial<Pick<EtfCurrentStateStore, 'read'>>
  now: () => string
  /**
   * 本轮信号的交接点。**只在**这一轮真的写入了新流水（`updated`）、且规则给出了成立的信号时才调用。
   *
   * 交出去的是「本轮判定出的信号」，不是「提交到平台的请求」：通知与自动分析是两个消费者，
   * 各自的开关、去重参数、额度都归它们自己，装配处把这条交接接过去再分。这样这一层的用例
   * 钉的是「刷新把信号交了出去」，不会因为生产把通知关掉、或分析还没接上就变红。
   */
  handOffSignals?: (signals: readonly ModuleSignal[]) => Promise<void>
}) {
  return {
    async refresh(): Promise<Readonly<{ state: 'updated' | 'unchanged'; reason?: never } | { state: 'unavailable'; reason?: 'fact.source-conflict' }>> {
      // 解析每轮现算。冲突 fail-closed：这一轮谁都不写，绝不挑第一个。
      const resolution = await deps.resolveFactSource()
      if (resolution.kind === 'conflict') return Object.freeze({ state: 'unavailable' as const, reason: 'fact.source-conflict' as const })
      // 两个源都授权采（**主源 CryptoETF、备源 0xRouter**，优先级由装配处的解析器决定）；
      // 解析出来不在允许集里（或没有）就停手，别拿错客户端静默去采。
      if (resolution.kind !== 'resolved') return unavailable()
      const resolvedSource = resolution.sourceId
      // 解析器给的是注册表 id，窗口契约认的是窗口 id——翻译只走 `etfWindowSourceIdFor`。
      // 少了这一步，备源被解析出来的那一轮整轮 fail-closed，而且哪一层都不报错（2026-11-17）。
      const sourceId = etfWindowSourceIdFor(resolvedSource)
      if (!sourceId) return unavailable()
      if (!(etfCurrentStateWindowPolicy.allowedSourceIds as readonly string[]).includes(sourceId)) return unavailable()
      // 开关与凭据按**注册表 id**问（profile 是按它存的）；`sourceId` 只用于行上的来源与窗口归属。
      if (!await enabled(() => deps.isEnabled(resolvedSource)) || !await enabled(() => deps.hasCredential(resolvedSource))) return unavailable()
      const fetchedAt = deps.now()
      const currentUtcDate = etfCurrentStateRefreshAdmissionPolicy.currentUtcDate(fetchedAt)
      if (!currentUtcDate) return unavailable()
      try {
        const requested = await deps.requestWindow(resolvedSource)
        if (requested.state === 'unavailable') return unavailable()
        const previous = requested.state === 'partial' && deps.store.read ? await deps.store.read() : null
        // 换源期不再拦混源：窗口契约从 2026-11-17 起允许行级来源（主源 + 备源互补），
        // 每一行自己带 source，窗口归属由 `etfWindowSource` 回答，所以「补一支」不会再拼出假口径。
        const btc = requested.state === 'partial' ? mergeRows(previous?.snapshot?.window.btc, requested.btc) : requested.btc
        const eth = requested.state === 'partial' ? mergeRows(previous?.snapshot?.window.eth, requested.eth) : requested.eth
        if (!btc || !eth) return unavailable()
        // 写之前先留一份旧窗口**和它被读到的时刻**：只有这两样一起，才知道「上次读到它时
        // 已经定稿了吗」——只看当前这一读，会把补报完成当成判后又变。
        const priorSnapshot = deps.store.read
          ? previous ?? await deps.store.read()
          : null
        const priorWindow = priorSnapshot?.snapshot?.window
        const priorAsOf = priorSnapshot?.snapshot?.verifiedAt
        // 每一行的「第一次进库」从旧窗口继承；旧窗口还没有这一天，才是这一轮进来的（用户 2026-11-17）。
        const firstSeen = priorFirstSeenAt(priorWindow)
        const built = buildWindow({ btc, eth, fetchedAt, currentUtcDate, sourceId, firstSeen })
        if (!built) return unavailable()
        // `replace` is async: the write's own verdict decides whether this round produced news.
        const replaced = await deps.store.replace({ window: built, verifiedAt: fetchedAt })
        // Awaited: the notification is part of what this refresh did, and a fire-and-forget call
        // made "did it go out?" depend on scheduling — the one thing a refresh result should not
        // depend on. The outlet swallows a failed submit, so this cannot turn into a failed read.
        if (replaced.state === 'updated') {
          // 定稿后仍变的交易日记一条（30 小时余量够不够，靠这条数据回答，不靠再猜一次）。
          reportSettledEtfRevisions({ previous: priorWindow, previousAsOf: priorAsOf, current: built, asOf: fetchedAt })
          const signals = judgeSignals(built, fetchedAt)
          // 一条成立的信号都没有时不去打扰出口：安静的一天不是「发了 0 条」，是「没有事发生」。
          if (signals.length > 0) await deps.handOffSignals?.(signals)
        }
        return replaced
      } catch {
        return unavailable()
      }
    }
  }
}

/**
 * 两个资产各自的信号，读的是刚写进 store 的同一份窗口。
 *
 * 只有完整窗口才会被 `buildEtfOutflowSignal` 判成 `available`；不足三日的信息是
 * `unavailable`（还没轮到它说话），消费者会把它挡掉，这里不另判一次——规则只说一次。
 */
function judgeSignals(
  window: Readonly<{ btc: readonly EtfDailyFlow[]; eth: readonly EtfDailyFlow[] }>,
  // 这一轮采集的时刻：信号描述的是刚写进去的那份窗口，不是「现在」。
  asOf: string
): readonly ModuleSignal[] {
  return (['btc', 'eth'] as const).flatMap((asset) => {
    const signal = buildEtfOutflowSignal({ asset, rows: window[asset], asOf })
    return signal ? [signal] : []
  })
}

async function enabled(read: () => Promise<boolean>): Promise<boolean> {
  try { return await read() } catch { return false }
}

/**
 * 「这一天的读数几点第一次进库」：按 `资产:交易日` 建索引，从上一份窗口继承。
 *
 * `fetchedAt` 每轮刷新都变，回答不了这个问题——用户问「16 号怎么还没来」时要的是这一列。
 */
function priorFirstSeenAt(window: EtfCurrentStateWindow | undefined): Readonly<{ seen: ReadonlyMap<string, string>; known: ReadonlySet<string> }> {
  const seen = new Map<string, string>()
  const known = new Set<string>()
  for (const flow of window ? [...window.btc, ...window.eth] : []) {
    const key = `${flow.asset}:${flow.tradingDate}`
    known.add(key)
    if (flow.firstSeenAt) seen.set(key, flow.firstSeenAt)
  }
  return { seen, known }
}

/**
 * 一行该写什么「第一次进库」：
 * - 旧窗口记过 → 原样继承；
 * - 旧窗口有这一天、但当时还没有这一列（升级前的行）→ **不写**，就是「不知道」，
 *   不能拿这一轮的时间冒充它，否则每一行都会说自己今天才到；
 * - 旧窗口没有这一天 → 这一轮。
 */
function firstSeenAtFor(
  key: string,
  firstSeen: Readonly<{ seen: ReadonlyMap<string, string>; known: ReadonlySet<string> }>,
  fetchedAt: string
): Readonly<{ firstSeenAt?: string }> {
  const inherited = firstSeen.seen.get(key)
  if (inherited !== undefined) return Object.freeze({ firstSeenAt: inherited })
  if (firstSeen.known.has(key)) return Object.freeze({})
  return Object.freeze({ firstSeenAt: fetchedAt })
}

function buildWindow(input: Readonly<{
  btc: readonly EtfFlowHistoryRow[]
  eth: readonly EtfFlowHistoryRow[]
  fetchedAt: string
  currentUtcDate: string
  /** 这一窗的数据来自哪个源：行上如实写它，别把备源的数记成主源的。 */
  sourceId: EtfFlowSourceId
  firstSeen: Readonly<{ seen: ReadonlyMap<string, string>; known: ReadonlySet<string> }>
}>) {
  const btc = toFlows(input.btc, 'BTC', input.fetchedAt, input.currentUtcDate, input.sourceId, input.firstSeen)
  const eth = toFlows(input.eth, 'ETH', input.fetchedAt, input.currentUtcDate, input.sourceId, input.firstSeen)
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
  const revision = etfWindowRevision([...built.window.btc, ...built.window.eth])
  return Object.freeze({ ...built.window, ...(revision ? { revision } : {}) })
}

function toFlows(rows: readonly EtfFlowHistoryRow[], asset: EtfAsset, fetchedAt: string, currentUtcDate: string, sourceId: EtfFlowSourceId, firstSeen: Readonly<{ seen: ReadonlyMap<string, string>; known: ReadonlySet<string> }>): readonly EtfDailyFlow[] | undefined {
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
      // 见过的日子保留它原来记下的时刻；新来的那一轮才是 fetchedAt。
      ...firstSeenAtFor(`${asset}:${tradingDate}`, firstSeen, fetchedAt),
      source: (row.source ?? sourceId) as EtfFlowSourceId,
      ...(row.updateTime ? { sourceRevision: row.updateTime } : {})
    }))
  }
  return flows.sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
}

function mergeRows(previous: readonly EtfDailyFlow[] | undefined, incoming: readonly EtfFlowHistoryRow[] | undefined): readonly EtfFlowHistoryRow[] | undefined {
  if (!previous && !incoming) return undefined
  const byDate = new Map<number, EtfFlowHistoryRow>()
  // **带上原来那一行的来源**：partial 合并时旧行不该被重新盖上本轮解析出来的源。
  for (const row of previous ?? []) byDate.set(Date.parse(`${row.tradingDate}T00:00:00.000Z`), { date: Date.parse(`${row.tradingDate}T00:00:00.000Z`), changeUsd: row.netFlowUsd, source: row.source, ...(row.sourceRevision ? { updateTime: row.sourceRevision } : {}) })
  for (const row of incoming ?? []) byDate.set(row.date, row)
  return [...byDate.values()].sort((left, right) => left.date - right.date)
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
