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
export const fredIndicatorYoYPolicy = Object.freeze({
  endpoint: 'https://api.stlouisfed.org/fred/series/observations',
  /** 指标身份 → FRED 序列。**只用未季调序列**（与 BLS 公布口径一致）。 */
  seriesByMetricKey: Object.freeze({
    'US.CPI.NSA.YOY': 'CPIAUCNS',
    'US.CORE_CPI.NSA.YOY': 'CPILFENS',
    'US.CORE_PCE.NSA.YOY': 'PCEPILFE'
  } as const),
  /** FRED 直接算好的同比，不是指数。 */
  units: 'pc1'
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
export function fredSeriesFor(metricKey: string): string | undefined {
  return (fredIndicatorYoYPolicy.seriesByMetricKey as Readonly<Record<string, string>>)[metricKey]
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
  const seriesId = fredSeriesFor(metricKey)
  if (seriesId === undefined) return { state: 'unavailable', seriesId: '', reason: 'no-series' }
  let rows: readonly Readonly<{ date: string; value: string }>[]
  try {
    rows = await fetchObservations({ seriesId, units: fredIndicatorYoYPolicy.units, limit: 4 })
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
    return {
      ...fact, state: 'provided', value: reading.value, source: 'fred',
      releasedAt: reading.observedAt,
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
