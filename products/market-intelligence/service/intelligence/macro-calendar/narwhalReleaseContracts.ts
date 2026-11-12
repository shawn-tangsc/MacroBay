/**
 * Narwhal 发布行的写入契约（换源第一笔：**双写**，不改可见性）。
 *
 * 这一版只解决「新源的数据怎么落库、怎么被读」，不做替换：0xRouter 仍是可见源，
 * Narwhal 的行先写进自己的表，等对账通过再谈切分点。
 */

/**
 * 发布时刻的精度声明，原样保留 Narwhal 的 `date_basis`。
 *
 * **只有两种取值**：实测扫了 2026-11-01..12-15 共 1,987 条，`indicative` 1,383 条、缺省 604 条，
 * 源里从来没有 `date-only`。多列一个没人能验的取值，就是我们替来源编了一个值——
 * 「只显示日期」是 `timePrecision` 的事，不该混进这一列。
 */
export type NarwhalDateBasis = 'exact' | 'indicative'

/**
 * 由 `date_basis` 派生「这一行能不能显示到分钟」。
 *
 * `indicative` 是来源自己说「这只是个大致时刻」——渲染层只能显示日期，
 * **不许把占位时刻渲染成具体分秒**（那会把来源的不确定说成我们的确定）。
 */
export type NarwhalTimePrecision = 'minute' | 'date'

export function timePrecisionOf(dateBasis: NarwhalDateBasis): NarwhalTimePrecision {
  return dateBasis === 'exact' ? 'minute' : 'date'
}

export type NarwhalReleaseValue = Readonly<{
  measure: string
  concept?: string
  unit?: string
  transformation?: string
  previous?: string
  consensus?: string
  actual?: string
}>

/** 一行 = 一次发布（`release_id` 是分组键），不再是「国家+时刻+名称同族」的近似合并。 */
export type NarwhalReleaseRow = Readonly<{
  releaseId: string
  providerId: string
  countryCode: string
  scheduledDate: string
  scheduledAt?: string
  dateBasis: NarwhalDateBasis
  status?: string
  values: readonly NarwhalReleaseValue[]
  detectedAt: string
  recordedAt: string
}>

/**
 * 首发布快照：**第一次看到某期时**记下当时来源给的 `previous`。
 *
 * 之后来源修订了 `previous`，这里**不覆盖**——卡上的「较上期（未修正）」要的是第一次那个数，
 * 不是修订后的数。没有这一行就表示「无法确认首发布值」，界面照文档显示那句话，
 * 不许回填 0、也不许拿修订值顶。
 */
export type NarwhalFirstPublished = Readonly<{
  releaseKey: string
  providerId: string
  firstPrevious?: string
  firstActual?: string
  capturedAt: string
}>
