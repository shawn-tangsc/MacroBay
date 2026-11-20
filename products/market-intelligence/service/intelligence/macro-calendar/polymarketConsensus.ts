import { metricConceptByMetricKey } from '../../../contracts/metricKeyConcept'
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
  eventsEndpoint: 'https://gamma-api.polymarket.com/events',
  /**
   * **概念** → slug 模板：按模板拼出这一期的 slug 直接 `?slug=` 查，不走搜索。
   * 搜索结果的顺序与期间无关，按标题匹配会漏场（非农那一场标题甚至不带年份）。
   * `{month}` 是英文全拼小写、`{year}` 四位年份。
   *
   * 按**概念**建表（M4），不按码：季调/未季调是同一个市场，模板只取决于「这是哪个指标」。
   * 按码建的时候，换一次口径就得回来搬一行——漏了就是「市场开着、我们没去查」，卡上却写「盘未开」，
   * 今晚那个 PCE 故障就是这么来的。
   */
  slugTemplateByConcept: Object.freeze({
    'US.CPI.YOY': '{month}-inflation-us-annual',
    'US.CORE_CPI.YOY': 'core-cpi-yoy-{month}-{year}',
    'US.CORE_PCE.YOY': 'core-pce-yoy-{month}-{year}',
    'US.NONFARM.CHANGE': 'how-many-jobs-added-in-{month}-{year}'
  } as const),
  /**
   * 档位标签是「100k to 125k」这种**绝对人数**，而卡片的口径是千（`+165K`）。
   * 换算只在这里做一次，别让读出来的数带着绝对人数流进渲染层。同样按概念建。
   */
  valueDivisorByConcept: Object.freeze({
    'US.NONFARM.CHANGE': 1000
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

/**
 * 按模板拼出这一期的 slug（月份英文全拼、小写）；期间不是 `YYYY-MM`、或这个指标没有盘口，就没有 slug。
 *
 * 先归一到概念再查模板：同一概念的季调/未季调变体取到同一个市场，换码不用回来改这张表。
 */
export function polymarketSlugFor(metricKey: string, period: string): string | undefined {
  const concept = metricConceptByMetricKey[metricKey]
  if (concept === undefined) return undefined
  const template = (polymarketConsensusPolicy.slugTemplateByConcept as Readonly<Record<string, string>>)[concept]
  if (template === undefined) return undefined
  const [year, month] = period.split('-').map(Number) as [number, number]
  const name = MONTH_NAMES[month - 1]
  if (name === undefined) return undefined
  return template.replace('{month}', name.toLowerCase()).replace('{year}', String(year))
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
  const slug = polymarketSlugFor(input.metricKey, input.period)
  if (slug === undefined) return { state: 'unavailable', reason: 'no-market' }
  // 发布之后的盘是结果，不是预期：连查都不查（也省一次请求）。
  if (Date.parse(input.asOf) >= Date.parse(input.releaseAt)) return { state: 'unavailable', reason: 'after-release' }

  let detail: unknown
  try {
    detail = JSON.parse(await input.fetchText(`${polymarketConsensusPolicy.eventsEndpoint}?slug=${encodeURIComponent(slug)}`))
  } catch {
    return { state: 'unavailable', reason: 'read-failed' }
  }
  // 该期没开盘：这个 slug 查回来是空的。这与「请求失败」是两件事。
  if (!eventExists(detail, slug)) return { state: 'unavailable', reason: 'no-market' }
  const buckets = readBuckets(detail, slug)
  const median = weightedMedianFromBuckets(buckets)
  if (median === undefined) return { state: 'unavailable', reason: 'no-buckets' }
  const concept = metricConceptByMetricKey[input.metricKey]
  const divisor = (concept === undefined ? undefined
    : (polymarketConsensusPolicy.valueDivisorByConcept as Readonly<Record<string, number>>)[concept]) ?? 1
  const value = median / divisor

  const marketVolume = readVolume(detail, slug)
  const gate = checkConsensusCandidate({
    metricKey: input.metricKey, period: input.period, provenance: 'market-implied',
    value, asOf: input.asOf, releaseAt: input.releaseAt,
    ...(marketVolume === undefined ? {} : { marketVolume })
  })
  if (gate.state === 'rejected') {
    // 盘**找到了**、只是成交量读不到：这是「读不到」，不是「没有这个盘」。
    return { state: 'unavailable', reason: gate.missing.includes('marketVolume') ? 'no-volume' : 'after-release' }
  }
  return { state: 'ok', value, marketVolume: marketVolume!, asOf: input.asOf, provenance: 'market-implied' }
}

/** `?slug=` 查回来可能是数组或单个对象；空数组就是这一期没开盘。 */
function eventExists(payload: unknown, slug: string): boolean {
  const list = Array.isArray(payload) ? payload : [payload]
  return list.some((entry) => Boolean(entry) && typeof entry === 'object' && (entry as { slug?: unknown }).slug === slug)
}

/**
 * 在搜索结果里找**那一期**的那一场。判据两条，任一满足即可：
 * - `slug` 含 `november-2026`（线上 slug 一定带年份，标题却常常不带：`How many jobs added in November?`）；
 * - 标题含 `November 2026`（有的场次标题带年份）。
 *
 * 找不到就是不显示，**不按相似度挑**——挑错一期等于把别的月份的盘当成这一期。
 */
function findSlug(payload: unknown, token: string): string | undefined {
  const slugToken = token.toLowerCase().replace(' ', '-')
  const events = Array.isArray((payload as { events?: unknown })?.events) ? (payload as { events: unknown[] }).events : []
  for (const entry of events) {
    if (!entry || typeof entry !== 'object') continue
    const title = typeof (entry as { title?: unknown }).title === 'string' ? (entry as { title: string }).title : ''
    const slug = typeof (entry as { slug?: unknown }).slug === 'string' ? (entry as { slug: string }).slug : ''
    if (slug === '') continue
    // 期间词按 slug 匹配：标题里常没有年份，只按标题会漏掉整场。
    if (slug.toLowerCase().includes(slugToken) || title.includes(token)) return slug
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
    // 线上把 `outcomePrices` 序列化成**字符串**（`"[\"0.17\", \"0.83\"]"`），不是数组；
    // 只认数组会让每一档都被跳过，整场判成 `no-buckets`。
    const prices = readPriceList(record.outcomePrices)
    const yes = prices[0] === undefined ? Number.NaN : Number(prices[0])
    if (!label || !Number.isFinite(yes)) continue
    const bounds = parseBucketBounds(label)
    if (bounds === undefined) continue
    buckets.push({ label, yes, ...bounds })
  }
  return buckets
}

function readPriceList(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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
