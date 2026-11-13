import { isValidIsoTime } from '../public-query/asOfVisibility'

/**
 * 盘口反推共识（数据侧，**不碰界面**）。
 *
 * 一条可显示的共识是**五元组**，不是一个数：值 + 期次 + `asOf` + `provenance` + 成交量。
 * 必需项按 `provenance` 分档——一律要求成交量会把「手填 / 商业源问卷」永久判非法，那是另一种极端。
 */

export type ConsensusProvenance = 'market-implied' | 'source-survey' | 'manual'

/**
 * 每一档「缺一项就不许显示」的必需集合。写成表而不是一串 `if`：
 * 三档差别不摆在一处，就只能靠逐行读 `if` 确认有没有漏一档。
 */
export const requiredFieldsByProvenance = Object.freeze({
  'market-implied': Object.freeze(['value', 'period', 'asOf', 'marketVolume'] as const),
  'source-survey': Object.freeze(['value', 'period', 'asOf', 'sourceName'] as const),
  manual: Object.freeze(['value', 'period', 'asOf', 'enteredBy'] as const)
}) as Readonly<Record<ConsensusProvenance, readonly string[]>>

/** 一个档位：标签原文、Yes 概率、以及它代表的数值区间（开区间为缺省一端）。 */
export type ConsensusBucket = Readonly<{
  label: string
  yes: number
  lower?: number
  upper?: number
}>

export type ConsensusCandidate = Readonly<{
  metricKey: string
  period: string
  provenance: ConsensusProvenance
  value?: number
  asOf?: string
  /** 这一期的**发布时刻**：盘口共识只有在它之前取的才算「预期」。 */
  releaseAt?: string
  marketVolume?: number
  sourceName?: string
  enteredBy?: string
}>

export type ConsensusCheck =
  | Readonly<{ state: 'displayable' }>
  | Readonly<{ state: 'rejected'; missing: readonly string[] }>

/**
 * 五元组校验：按 `provenance` 查必需集合；`market-implied` 另加一条**时点判据**——
 * `asOf` 必须早于发布时间。发布之后那个盘反映的是结果，不是预期，拿它当共识就是把已知答案包装成预测。
 */
export function checkConsensusCandidate(candidate: ConsensusCandidate): ConsensusCheck {
  const missing = requiredFieldsByProvenance[candidate.provenance].filter((field) => {
    const value = candidate[field as keyof ConsensusCandidate]
    if (field === 'marketVolume') return typeof value !== 'number' || !Number.isFinite(value)
    if (field === 'value') return typeof value !== 'number' || !Number.isFinite(value)
    return typeof value !== 'string' || value === ''
  })
  if (missing.length > 0) return { state: 'rejected', missing }
  if (candidate.provenance === 'market-implied') {
    if (candidate.asOf === undefined || !isValidIsoTime(candidate.asOf)) return { state: 'rejected', missing: ['asOf'] }
    if (candidate.releaseAt === undefined || !isValidIsoTime(candidate.releaseAt)) return { state: 'rejected', missing: ['releaseAt'] }
    // 发布之后取的盘是结果，不是预期：整条不显示，不是降权。
    if (Date.parse(candidate.asOf) >= Date.parse(candidate.releaseAt)) return { state: 'rejected', missing: ['asOfBeforeRelease'] }
  }
  return { state: 'displayable' }
}

/**
 * 加权中位数反推：档位权重 = Yes 概率，档位取值 = 区间中点；开区间沿用相邻档的宽度。
 *
 * **不取最高档**——最高档只说明「最可能」，不说明预期值落在哪；两档接近时它会把结论甩到一边。
 */
export function weightedMedianFromBuckets(buckets: readonly ConsensusBucket[]): number | undefined {
  const usable = buckets
    .filter((bucket) => Number.isFinite(bucket.yes) && bucket.yes > 0)
    .map((bucket) => ({ ...bucket, midpoint: midpointOf(bucket, buckets) }))
    .filter((bucket): bucket is typeof bucket & { midpoint: number } => bucket.midpoint !== undefined)
  const total = usable.reduce((sum, bucket) => sum + bucket.yes, 0)
  if (total <= 0) return undefined
  const sorted = [...usable].sort((left, right) => left.midpoint - right.midpoint)
  let cumulative = 0
  for (const bucket of sorted) {
    cumulative += bucket.yes / total
    if (cumulative >= 0.5) return bucket.midpoint
  }
  return sorted[sorted.length - 1]?.midpoint
}

/** 档位中点：开区间那两档用相邻档的宽度外推，不外推就取端点本身（不猜方向）。 */
function midpointOf(bucket: ConsensusBucket, all: readonly ConsensusBucket[]): number | undefined {
  if (bucket.lower !== undefined && bucket.upper !== undefined) return (bucket.lower + bucket.upper) / 2
  const point = bucket.lower ?? bucket.upper
  if (point === undefined) return undefined
  const bounds = all.filter((entry) => entry.lower !== undefined && entry.upper !== undefined)
  if (bounds.length === 0) return point
  const widths = bounds.map((entry) => entry.upper! - entry.lower!)
  const width = Math.min(...widths)
  return bucket.lower === undefined ? point + width / 2 : point - width / 2
}
