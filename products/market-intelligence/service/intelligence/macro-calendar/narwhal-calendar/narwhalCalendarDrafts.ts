import type { NarwhalParsedRelease } from './narwhalCalendarParser'
import { eventCodeBySourceType } from '../marketCalendarEventCodeTable'
import { narwhalEventSourceEventId, narwhalMeasureMetricKeys, narwhalSourceEventIdForIdentity } from '../marketCalendarMetricIdentity'

/**
 * Narwhal 的**草稿层**：一次采集的每条发布 → 观测表的一行/多行（`measure_keys_json` 只带一个码）。
 *
 * 从 `narwhalCalendarObservationBatches.ts` 抽出来（2026-11-21，体积门禁：那个文件 504 行）。
 * 拆行口径见方案 §2.4：**一条发布按 measure 各一条 draft**，值、身份各归各位。
 */

export type NarwhalCalendarLocale = 'zh' | 'en'

export const feedByKind = Object.freeze({
  'economic-indicator': 'macro-calendar-narwhal-economic-data',
  'financial-event': 'macro-calendar-narwhal-financial-events',
  'central-bank-activity': 'macro-calendar-narwhal-central-bank-activities'
} as const)
export type NarwhalEventKind = keyof typeof feedByKind

/** 事件型的分型：讲话/央行沟通归央行活动，其余（资产负债表、能源报告等）归金融事件。 */
export function eventKindOf(topic: string | undefined): NarwhalEventKind {
  return topic === 'policy_communication' ? 'central-bank-activity' : 'financial-event'
}

/**
 * 存储层认的国家码是两位（`US` / `DE`），身份口径是三位（ISO alpha-3）。写入时按存储归一，
 * 身份串里保留三位——两处各用各的口径，读取侧再归一，不然同一个国家会出现两个 key。
 */
const storageCountryCode: Readonly<Record<string, string>> = Object.freeze({
  USA: 'US', CAN: 'CA', DEU: 'DE', GBR: 'GB', JPN: 'JP', CHN: 'CN', EUR: 'EU'
})

function storageCodeOf(country: string): string | undefined {
  return storageCountryCode[country]
}


/**
 * **一条发布 → 若干条 draft：按 measure 各一条**（用户 2026-11-21 拍板 ①）。
 *
 * 事故形状：一条发布覆盖非农与失业率，旧实现只带**一份值**（主测度的）却把两个码都写进
 * `measureKeys`，下游按它展开就把非农的 165 记到失业率名下——「值属于哪个指标」在 draft 层就丢了。
 *
 * 观测层的身份仍是**三段**（`国家|指标码|期`，`market_fact_key` / `candidate_key` 不变）；
 * 每个 measure 各算各的，主测度那条与拆分前逐字节相同，旧键照旧可解。
 *
 * 不走拆分的四种情形，一律保持原来那一条（行为不变）：
 * 事件型（没有数值格）、没有 `period`、一个 measure 都没映射上、`economic-indicator` 但没有值。
 */
export function draftsOf(release: NarwhalParsedRelease, kind: NarwhalEventKind, locale: NarwhalCalendarLocale): readonly Record<string, unknown>[] {
  const measureDrafts = kind === 'economic-indicator' ? measureDraftsOf(release) : undefined
  if (measureDrafts === undefined) return [draftOf(release, kind, locale)]
  return measureDrafts.map(({ metricKey, value }) => draftOf(release, kind, locale, { metricKey, value }))
}

/**
 * 一条发布里**每个 measure 一条**，按 `metricKey` 去重；返回 `undefined` 表示「不拆，保持一条」。
 *
 * 撞键规则（方案 §2.3-A）：同一发布里两个 measure 名映射到同一个码时只留一条——
 * `measure === concept` 优先 → 有 actual → 有 previous → 发布里的先后；丢掉的条数打一行 warn。
 */
function measureDraftsOf(release: NarwhalParsedRelease): readonly { metricKey: string; value: NarwhalParsedRelease['values'][number] }[] | undefined {
  const period = release.period
  if (period === undefined || period.length === 0) return undefined
  const mapped = release.values.flatMap((value, index) => {
    const metricKey = narwhalMeasureMetricKeys[value.measure]
    return metricKey === undefined ? [] : [{ metricKey, value, index }]
  })
  if (mapped.length === 0) return undefined
  const kept = new Map<string, { metricKey: string; value: NarwhalParsedRelease['values'][number]; index: number }>()
  for (const item of mapped) {
    const current = kept.get(item.metricKey)
    if (current === undefined || preferredMeasure(item, current)) kept.set(item.metricKey, item)
  }
  const dropped = mapped.length - kept.size
  if (dropped > 0) {
    console.warn(`[macro-calendar] 多 measure 合并 ${dropped} 条（同码别名）：${[...kept.keys()].join(', ')}`)
  }
  // 主测度排第一：它的身份必须与拆分前一致，日志与对账都按这个顺序看。
  const primary = primaryMappedValue(release)
  const primaryKey = primary === undefined ? undefined : narwhalMeasureMetricKeys[primary.measure]
  const ordered = [...kept.values()].sort((left, right) =>
    (left.metricKey === primaryKey ? 0 : 1) - (right.metricKey === primaryKey ? 0 : 1) || left.index - right.index)
  return ordered.map(({ metricKey, value }) => ({ metricKey, value }))
}

/** 撞码时谁留下（方案 §2.3-A）：`measure === concept` → 有 actual → 有 previous → 先出现的。 */
function preferredMeasure(
  next: { value: NarwhalParsedRelease['values'][number] },
  current: { value: NarwhalParsedRelease['values'][number] }
): boolean {
  const score = (value: NarwhalParsedRelease['values'][number]): number =>
    (value.measure === value.concept ? 4 : 0)
    + (value.actual !== undefined && value.actual.trim() !== '' ? 2 : 0)
    + (value.previous !== undefined && value.previous.trim() !== '' ? 1 : 0)
  return score(next.value) > score(current.value)
}

export function draftOf(
  release: NarwhalParsedRelease,
  kind: NarwhalEventKind,
  locale: NarwhalCalendarLocale,
  /** 给了就按这个 measure 出身份与值；不给则是「不拆分」的那条（原行为）。 */
  measure?: { metricKey: string; value: NarwhalParsedRelease['values'][number] }
): Record<string, unknown> {
  const descriptorId = feedByKind[kind]
  const period = release.period ?? ''
  /**
   * 拆出来的 draft：身份按**它自己的**指标码算（仍三段，观测层口径）；
   * 不拆的那条仍走 `sourceEventIdOf`（主测度 / 事件码 / releaseId，与改动前逐字节相同）。
   */
  const sourceEventId = measure === undefined
    ? sourceEventIdOf(release, kind)
    : narwhalSourceEventIdForIdentity({ countryCode: release.country, metricKey: measure.metricKey, periodKey: period })
  const valued = measure?.value ?? (kind === 'economic-indicator' ? primaryMappedValue(release) : undefined)
  const measureKeys = measure === undefined
    ? [...new Set(release.values.map((value) => narwhalMeasureMetricKeys[value.measure])
      .filter((key): key is string => key !== undefined))]
    : [measure.metricKey]
  return {
    providerId: 'narwhal',
    descriptorId,
    kind,
    locale,
    sourceEventId,
    marketFactKey: JSON.stringify(['narwhal', descriptorId, locale, sourceEventId]),
    identityState: 'unverified',
    localeMerge: 'disabled',
    officialLink: 'disabled',
    displayName: release.name,
    ...(storageCodeOf(release.country) === undefined ? {} : { countryCode: storageCodeOf(release.country)! }),
    importance: 'medium',
    scheduledDate: release.eventDate,
    scheduledAt: release.at,
    ...(measureKeys.length === 0 ? {} : { measureKeys: measureKeys.join(',') }),
    ...(valued === undefined ? {} : {
      consensus: displayValueOf(valued.consensus),
      providerPrevious: displayValueOf(valued.previous),
      providerActual: displayValueOf(valued.actual)
    })
  }
}

/** 有值：规范身份；没有 `period` 或指标不在表里：来源自己的 `release_id`（读回来即 unmapped）。 */
export function sourceEventIdOf(release: NarwhalParsedRelease, kind: NarwhalEventKind): string {
  if (kind === 'economic-indicator') {
    const valued = primaryMappedValue(release)
    const metricKey = valued === undefined ? undefined : narwhalMeasureMetricKeys[valued.measure]
    if (metricKey !== undefined && release.period !== undefined && release.period.length > 0) {
      return narwhalSourceEventIdForIdentity({ countryCode: release.country, metricKey, periodKey: release.period })
    }
  }
  // 指标型但**没有可映射的测度**（排期先到、或源压根没给 measure）：
  // 源名登记过事件码 → 事件身份 `(国家, 事件码, 时刻)`，采集时就把身份带上；
  // 连事件码都没有 → 源内身份，中段用 `release_id`，**绝不写裸 id**——裸 id 解不出身份，
  // 重放时只能记 `bad-identity`，同一批发布就永远补不回日历（实测三条：生产力与成本、
  // 达拉斯联储服务业调查、政策利率决议）。
  const fallbackCode = eventCodeBySourceType[release.name]
  if (fallbackCode !== undefined) return narwhalEventSourceEventId(release.country, fallbackCode, release.at)
  if (kind !== 'economic-indicator') {
    // 事件型身份 = (国家, 类型, 时刻)。时刻取来源给的发布时刻，分钟级。
    return narwhalEventSourceEventId(release.country, kind, release.at)
  }
  return narwhalEventSourceEventId(release.country, release.releaseId, release.at)
}

function displayValueOf(raw: string | undefined): Record<string, string> | undefined {
  return raw === undefined || raw.length === 0 ? undefined : { displayValue: raw }
}

/** 有值发布的主测度：优先 `measure === concept`，否则取第一个登记过的测度。 */
function primaryMappedValue(release: NarwhalParsedRelease) {
  const mapped = release.values.filter((value) => narwhalMeasureMetricKeys[value.measure] !== undefined)
  return mapped.find((value) => value.measure === value.concept) ?? mapped[0]
}

