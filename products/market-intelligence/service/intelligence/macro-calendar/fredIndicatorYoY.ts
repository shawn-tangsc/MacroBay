import { isValidIsoTime } from '../public-query/asOfVisibility'

/**
 * CPI 年率的官方读数：**只用 FRED 直接给出的同比**（`units=pc1`），绝不拿指数相除。
 *
 * 指数相除算出来的同比会与官方公布值有偏差（季调/未季调口径一差就是 0.02pp 起），
 * 而读者拿它跟新闻里的数比——那是这条链路的红线。
 *
 * 这里的读法只有一件：把 FRED 的观测行取回来，挑出最新一个有值的，记下它的观测日。
 * 取不到就是「读不到」，不退回日历里的旧值，也不写成「未提供」——三件事必须分得开。
 */
export type FredSeriesPolicy = Readonly<{
  seriesId: string
  /**
   * 取数口径：`pc1` = 同比（来源直接算好），`pch` = 环比（月率）。
   *
   * **口径跟着码走，不跟着调用点走**（架构师 2026-11-14）：`pch` 用在月度序列上是月率，
   * 用在季度序列上就是季率——只要有一个全局 `units`，接 GDP 那天就会静默错，
   * 而且错得看不出来。所以这里每个码自带一份，没有一个「看起来是全局」的字段。
   */
  units: 'pc1' | 'pch'
}>

export const fredIndicatorYoYPolicy = Object.freeze({
  endpoint: 'https://api.stlouisfed.org/fred/series/observations',
  /**
   * 指标身份 → FRED 序列 + 口径。**季调口径必须和码对上**：
   * `.SA.MOM` 用季调指数取 `pch`，`.NSA.YOY` 用未季调指数取 `pc1`；
   * 没有确证对应口径的码**不登记**（例如 `US.PCE.NSA.YOY`：FRED 月度只有季调指数），
   * 由 `coreIndicatorValueSources` 的例外清单记明原因，不拿季调顶未季调。
   */
  seriesByMetricKey: Object.freeze({
    // 同比（未季调序列，与 BLS 公布口径一致）
    'US.CPI.NSA.YOY': { seriesId: 'CPIAUCNS', units: 'pc1' },
    'US.CORE_CPI.NSA.YOY': { seriesId: 'CPILFENS', units: 'pc1' },
    // PCE 价格指数的公布口径本来就是季调（BEA）：值走 SA 码，标签才和数一致。
    // NSA 两个码对应「未季调年率」，目前没有未季调序列，留空并进例外清单——不拿季调顶。
    'US.PCE.SA.YOY': { seriesId: 'PCEPI', units: 'pc1' },
    'US.CORE_PCE.SA.YOY': { seriesId: 'PCEPILFE', units: 'pc1' },
    'US.AHE.NSA.YOY': { seriesId: 'CEU0500000003', units: 'pc1' },
    // 月率（季调指数，取 `pch`）
    'US.CPI.SA.MOM': { seriesId: 'CPIAUCSL', units: 'pch' },
    'US.CORE_CPI.SA.MOM': { seriesId: 'CPILFESL', units: 'pch' },
    'US.PCE.SA.MOM': { seriesId: 'PCEPI', units: 'pch' },
    'US.CORE_PCE.SA.MOM': { seriesId: 'PCEPILFE', units: 'pch' },
    'US.AHE.SA.MOM': { seriesId: 'CES0500000003', units: 'pch' }
  } as const)
} as const)

export type FredYoYReading =
  | Readonly<{
    state: 'ok'
    value: number
    observedAt: string
    seriesId: string
    /** 再往前一个**有值**的观测：本期由官方给值时，「上一期」也从这里来，不回退旧源。 */
    previous?: Readonly<{ value: number; observedAt: string }>
  }>
  | Readonly<{ state: 'unavailable'; seriesId: string; reason: 'no-series' | 'no-observation' | 'read-failed' }>

export type FredObservationsFetcher = (input: Readonly<{
  seriesId: string
  units: string
  limit: number
}>) => Promise<readonly Readonly<{ date: string; value: string }>[]>

/** 这个指标有没有官方序列；没有就返回 `undefined`（调用方据此不显示官方那一格）。 */
export function fredSeriesFor(metricKey: string): FredSeriesPolicy | undefined {
  return (fredIndicatorYoYPolicy.seriesByMetricKey as Readonly<Record<string, FredSeriesPolicy>>)[metricKey]
}

/**
 * 取最新一个有值的观测（FRED 用 `.` 表示缺值，跳过而不是当 0），连它前面那个有值的观测一起带上。
 *
 * 带上前一个是为了「上一期」：这两个数都只有官方一处是真的，等旧源删掉以后再去问它，
 * 那一格就会在没人察觉的情况下变空。
 */
export async function readFredIndicatorYoY(
  metricKey: string,
  fetchObservations: FredObservationsFetcher
): Promise<FredYoYReading> {
  const policy = fredSeriesFor(metricKey)
  if (policy === undefined) return { state: 'unavailable', seriesId: '', reason: 'no-series' }
  const seriesId = policy.seriesId
  let rows: readonly Readonly<{ date: string; value: string }>[]
  try {
    rows = await fetchObservations({ seriesId, units: policy.units, limit: 4 })
  } catch {
    return { state: 'unavailable', seriesId, reason: 'read-failed' }
  }
  const valid: Readonly<{ value: number; observedAt: string }>[] = []
  for (const row of rows) {
    const value = Number(row.value)
    if (row.value.trim() === '' || row.value.trim() === '.' || !Number.isFinite(value)) continue
    if (!isValidIsoTime(`${row.date}T00:00:00.000Z`)) continue
    valid.push({ value, observedAt: `${row.date}T00:00:00.000Z` })
  }
  const latest = valid[0]
  if (latest === undefined) return { state: 'unavailable', seriesId, reason: 'no-observation' }
  const previous = valid[1]
  return {
    state: 'ok', value: latest.value, observedAt: latest.observedAt, seriesId,
    ...(previous === undefined ? {} : { previous })
  }
}

/**
 * 把官方读数贴到卡片事实上——**优先级：官方序列 > 日历库里的值**（读数），共识仍走日历/盘口。
 *
 * 两件事按「这期还是上期」分：
 * - FRED 最新观测**落在本期的期次上** → 它就是这一期的值（`state: provided`, `source: 'fred'`);
 * - 落在上一期 → 它填的是「上一期」那一格，主位仍按日历库的判断（本期可能确实没有值）。
 *
 * 读不到时把「上一期」标成读不到（`previousUnreadable`），**不退回旧源数字冒充**——
 * 旧源正在被删除，它那份「上一期」会冻结在删除那一刻。
 */
export function applyOfficialYoY(
  fact: import('./macroIndicatorCardFacts').MacroIndicatorCardFact,
  reading: FredYoYReading
): import('./macroIndicatorCardFacts').MacroIndicatorCardFact {
  if (reading.state === 'unavailable') {
    // `no-series` 是「这个指标没有官方序列」（非农、失业率），不是「读不到」：
    // 那条腿本来就不存在，抹成「暂时读不到」会把日历库里真有的上期值（29）一起弄没。
    if (reading.reason === 'no-series') return fact
    // 只有本来就该有「上一期」的那几档才标；`not-recorded` 没有行，谈不上「读不到」。
    return fact.state === 'not-recorded' ? fact : { ...fact, previousUnreadable: true }
  }
  const period = reading.observedAt.slice(0, 7)
  if (period === fact.period) {
    // 本期由官方给值时，「上一期」也取官方前一个观测——旧源正在删除，问它就是问一个正在冻结的值。
    // 官方窗口里拿不到前一个观测 → 这一格是「读不到」，不是「没有」。
    const previous = reading.previous
    /* **不写 `releasedAt`**：官方序列的一次观测不是一次发布（架构师 2026-11-14）。
       有真发布日就保留日历库那个（读者看到「刚发布 N 天」），没有就只带观测日（显示「更新于」）。 */
    return {
      ...fact, state: 'provided', value: reading.value, source: 'fred',
      seriesObservedAt: reading.observedAt,
      ...(previous === undefined
        ? { previousUnreadable: true }
        : {
          previousAsPublished: previous.value, previousSource: 'fred' as const,
          previousObservedAt: previous.observedAt, previousUnreadable: false
        })
    }
  }
  return {
    ...fact,
    previousAsPublished: reading.value,
    previousSource: 'fred',
    previousObservedAt: reading.observedAt,
    previousUnreadable: false
  }
}

/**
 * FRED 观测的取数口：URL 只在这里拼一次，请求**必须过装配层注入的 `fetchText`**
 * （它负责把 `api_key` 加上）——读服务里不碰凭据，也不自己拼 key。
 */
export function createFredObservationsFetcher(
  fetchText: (url: string, sourceId: string) => Promise<string>
): FredObservationsFetcher {
  return async ({ seriesId, units, limit }) => {
    const url = `${fredIndicatorYoYPolicy.endpoint}?${new URLSearchParams({
      series_id: seriesId, file_type: 'json', sort_order: 'desc', limit: String(limit), units
    }).toString()}`
    const body = JSON.parse(await fetchText(url, 'fred-rates-liquidity')) as { observations?: unknown }
    const rows = Array.isArray(body.observations) ? body.observations : []
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const record = row as Record<string, unknown>
      if (typeof record.date !== 'string' || typeof record.value !== 'string') return []
      return [{ date: record.date, value: record.value }]
    })
  }
}
