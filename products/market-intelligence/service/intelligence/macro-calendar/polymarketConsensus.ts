import { checkConsensusCandidate, weightedMedianFromBuckets, type ConsensusBucket } from './marketConsensusFromBuckets'

/**
 * 盘口共识：按「指标 + 期间 + 发布前时点」**现查** Polymarket，加权中位数反推。
 *
 * 三条硬约束（今晚付过学费）：
 * - **发布之后不取**：已发布那期的盘价是结果，不是预期；拿它当共识就是把已知答案包装成预测；
 * - **必须带成交量**：非农那个盘成交只有 5.3 千、价格扁平，不写成交量读者不知道这个共识有多轻；
 * - **没盘不估**：查不到就返回 `unavailable`，绝不留用上一期、也不写成 0。
 *
 * 「有没有盘」不是常量：过去期次会结算下架，所以每次按期间现查，不缓存成静态清单。
 */
export const polymarketConsensusPolicy = Object.freeze({
  searchEndpoint: 'https://gamma-api.polymarket.com/public-search',
  eventsEndpoint: 'https://gamma-api.polymarket.com/events',
  /** 指标 → 搜索词 + 标题里必须出现的期间词（盘口只有标题可认，不匹配就不显示，不猜）。 */
  searchByMetricKey: Object.freeze({
    'US.CPI.NSA.YOY': Object.freeze({ query: 'inflation us annual', seriesId: 'cpi-annual' }),
    'US.CORE_CPI.NSA.YOY': Object.freeze({ query: 'core cpi yoy', seriesId: 'core-cpi-yoy' }),
    'US.CORE_PCE.NSA.YOY': Object.freeze({ query: 'core pce yoy', seriesId: 'core-pce-yoy' }),
    'US.NONFARM.SA.CHANGE': Object.freeze({ query: 'how many jobs added', seriesId: 'jobs-added' })
  } as const)
} as const)

export type PolymarketConsensusReading =
  | Readonly<{ state: 'ok'; value: number; marketVolume: number; asOf: string; provenance: 'market-implied' }>
  | Readonly<{ state: 'unavailable'; reason: 'no-market' | 'no-buckets' | 'no-volume' | 'after-release' | 'read-failed' }>

export type PolymarketFetchText = (url: string) => Promise<string>

/** 「October 2026」这种期间词：只认这个，别用月份数字猜。 */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

export function polymarketPeriodToken(period: string): string | undefined {
  const [year, month] = period.split('-').map(Number) as [number, number]
  const name = MONTH_NAMES[month - 1]
  return name === undefined ? undefined : `${name} ${year}`
}

export async function readPolymarketConsensus(input: Readonly<{
  metricKey: string
  /** 这一期的期次，`YYYY-MM`。 */
  period: string
  /** 这一期的发布时刻：盘口必须在它之前取。 */
  releaseAt: string
  asOf: string
  fetchText: PolymarketFetchText
}>): Promise<PolymarketConsensusReading> {
  const target = (polymarketConsensusPolicy.searchByMetricKey as Readonly<Record<string, Readonly<{ query: string; seriesId: string }>>>)[input.metricKey]
  if (target === undefined) return { state: 'unavailable', reason: 'no-market' }
  const token = polymarketPeriodToken(input.period)
  if (token === undefined) return { state: 'unavailable', reason: 'no-market' }
  // 发布之后的盘是结果，不是预期：连查都不查（也省一次请求）。
  if (Date.parse(input.asOf) >= Date.parse(input.releaseAt)) return { state: 'unavailable', reason: 'after-release' }

  let events: unknown
  try {
    events = JSON.parse(await input.fetchText(`${polymarketConsensusPolicy.searchEndpoint}?q=${encodeURIComponent(target.query)}&limit_per_type=20`))
  } catch {
    return { state: 'unavailable', reason: 'read-failed' }
  }
  const slug = findSlug(events, token)
  if (slug === undefined) return { state: 'unavailable', reason: 'no-market' }

  let detail: unknown
  try {
    detail = JSON.parse(await input.fetchText(`${polymarketConsensusPolicy.eventsEndpoint}?slug=${encodeURIComponent(slug)}`))
  } catch {
    return { state: 'unavailable', reason: 'read-failed' }
  }
  const buckets = readBuckets(detail, slug)
  const value = weightedMedianFromBuckets(buckets)
  if (value === undefined) return { state: 'unavailable', reason: 'no-buckets' }

  const marketVolume = readVolume(detail, slug)
  const gate = checkConsensusCandidate({
    metricKey: input.metricKey, period: input.period, provenance: 'market-implied',
    value, asOf: input.asOf, releaseAt: input.releaseAt,
    ...(marketVolume === undefined ? {} : { marketVolume })
  })
  if (gate.state === 'rejected') {
    // 盘**找到了**、只是成交量读不到：这是「读不到」，不是「没有这个盘」。
    // 把两者都写成 `no-market`，卡上就会把「我们没查到」说成「市场上没有」。
    return { state: 'unavailable', reason: gate.missing.includes('marketVolume') ? 'no-volume' : 'after-release' }
  }
  return { state: 'ok', value, marketVolume: marketVolume!, asOf: input.asOf, provenance: 'market-implied' }
}

/** 在搜索结果里找「标题含期间词」的那一场；找不到就是不显示，不按相似度挑。 */
function findSlug(payload: unknown, token: string): string | undefined {
  const events = Array.isArray((payload as { events?: unknown })?.events) ? (payload as { events: unknown[] }).events : []
  for (const entry of events) {
    if (!entry || typeof entry !== 'object') continue
    const title = typeof (entry as { title?: unknown }).title === 'string' ? (entry as { title: string }).title : ''
    const slug = typeof (entry as { slug?: unknown }).slug === 'string' ? (entry as { slug: string }).slug : ''
    if (slug !== '' && title.includes(token)) return slug
  }
  return undefined
}

/** 各档：`groupItemTitle` 形如 `≤3.2%` / `3.7%` / `≥4.3%` / `<25k` / `100k to 125k` / `150k+`。 */
function readBuckets(payload: unknown, slug: string): readonly ConsensusBucket[] {
  const event = firstEvent(payload, slug)
  const markets = Array.isArray(event?.markets) ? event!.markets : []
  const buckets: ConsensusBucket[] = []
  for (const market of markets) {
    if (!market || typeof market !== 'object') continue
    const record = market as Record<string, unknown>
    const label = typeof record.groupItemTitle === 'string' ? record.groupItemTitle : ''
    const prices = Array.isArray(record.outcomePrices) ? record.outcomePrices : []
    const yes = typeof prices[0] === 'string' ? Number(prices[0]) : Number.NaN
    if (!label || !Number.isFinite(yes)) continue
    const bounds = parseBucketBounds(label)
    if (bounds === undefined) continue
    buckets.push({ label, yes, ...bounds })
  }
  return buckets
}

function readVolume(payload: unknown, slug: string): number | undefined {
  const volume = firstEvent(payload, slug)?.volume
  const parsed = typeof volume === 'number' ? volume : typeof volume === 'string' ? Number(volume) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function firstEvent(payload: unknown, slug: string): { markets?: unknown[]; volume?: unknown } | undefined {
  const list = Array.isArray(payload) ? payload : Array.isArray((payload as { events?: unknown })?.events) ? (payload as { events: unknown[] }).events : []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    if ((entry as { slug?: unknown }).slug === slug) return entry as { markets?: unknown[]; volume?: unknown }
  }
  return list[0] && typeof list[0] === 'object' ? list[0] as { markets?: unknown[]; volume?: unknown } : undefined
}

/**
 * 档位文字 → 数值区间。单位取档位里自带的那个（`%` 或 `k` 千人），不做跨单位换算。
 * 读不懂的档位直接跳过——猜一个区间会让中位数落在错的档。
 */
export function parseBucketBounds(label: string): { lower?: number; upper?: number } | undefined {
  const text = label.replace(/,/g, '').trim()
  const kScale = /k\b/i.test(text) || /\bk/i.test(text) ? 1000 : 1
  const numbers = text.match(/-?\d+(?:\.\d+)?/g)?.map((value) => Number(value) * kScale) ?? []
  if (numbers.length === 0) return undefined
  if (/^[≤<]/.test(text) || /\bunder\b/i.test(text) || /^</.test(text)) return { upper: numbers[0]! }
  if (/^[≥>]/.test(text) || /\+$/.test(text)) return { lower: numbers[0]! }
  if (numbers.length === 1) return { lower: numbers[0]!, upper: numbers[0]! }
  return { lower: Math.min(numbers[0]!, numbers[1]!), upper: Math.max(numbers[0]!, numbers[1]!) }
}
