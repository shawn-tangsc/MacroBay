import {
  MACRO_INDICATOR_CARD_KEYS, legacyIndicatorIdsByMetricKey, narwhalMeasuresByMetricKey,
  resolveMacroIndicatorFacts, type MacroIndicatorCardFact, type MacroIndicatorCardKey, type MacroIndicatorCardRow
} from './macroIndicatorCardFacts'
import { applyOfficialYoY, type FredYoYReading } from './fredIndicatorYoY'
import type { MacroCalendarLegacyMetricRow, MacroCalendarRepository } from './macroCalendarRepository'
import { narwhalMeasureMetricKeys, zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'
import type { NarwhalReleaseRow, NarwhalReleaseValue } from './narwhalReleaseContracts'

/**
 * 三张关键指标卡的读数：**按身份取「最新一次已发布」**。
 *
 * 口径全在 `macroIndicatorCardFacts`：这里只把库里那几行原始数据装配成它要的形状，
 * 不另判一次「哪一行算这个指标」——身份来自两张既有映射表（`narwhalMeasureMetricKeys`、
 * `zeroXRouterIndicatorIdentities`），期次来自既有的 `zeroXRouterCanonicalIdentity`。
 */
export type MacroIndicatorReadRepository = Pick<MacroCalendarRepository, 'readLatestReleaseForMetric'>

/**
 * 卡片读数只接受**规范 UTC 毫秒时刻**：别的形状（`2026-11-13` 这种只有日期的）会让
 * `scheduled_at <= asOf` 的边界变成猜的，接口宁可失败，也不把「没读到」画成「本月未发布」。
 */
export const macroIndicatorAsOfPolicy = {
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

/**
 * 外部读数（装配层注入，读服务里**不碰凭据、不碰网络出口**）：
 * - `readOfficialYoY`：官方序列的同比（FRED，`units=pc1`）；没有映射的指标可以不实现；
 * - `nextReleaseFor`：这个指标在 `asOf` 之后**最近一次排期**（期次 + 发布时刻），没有就返回 `undefined`。
 *   排期只有日历那一处是真的，这里不改写、不缓存、不拿上一期凑；
 * - `readMarketConsensus`：盘口反推的共识，**必须带期次与发布时刻**——查错期次会查到一个
 *   看起来完全正常的盘。
 *
 * 三个都可选：**没注入就当这一档不存在**，不退回猜测。装配处必须显式传，不能靠默认值。
 */
export type MacroMarketConsensusReading =
  | Readonly<{ state: 'ok'; value: number; marketVolume: number; asOf: string }>
  | Readonly<{ state: 'unavailable'; reason: 'no-market' | 'no-buckets' | 'after-release' | 'read-failed' }>

export type MacroIndicatorReadDependencies = Readonly<{
  readOfficialYoY?: (metricKey: string) => Promise<FredYoYReading>
  nextReleaseFor?: (metricKey: string, asOf: string) => Readonly<{ period: string; releaseAt: string }> | undefined
  readMarketConsensus?: (input: Readonly<{
    metricKey: string
    period: string
    releaseAt: string
    asOf: string
  }>) => Promise<MacroMarketConsensusReading>
}>

export type MacroIndicatorReadService = Readonly<{
  /** 四个指标的事实；`asOf` 不是规范 UTC 时刻就抛——读不到不能画成「本月未发布」。 */
  read: (input: { asOf: string }) => Promise<readonly MacroIndicatorCardFact[]>
}>

export function createMacroIndicatorReadService(
  repository: MacroIndicatorReadRepository,
  dependencies: MacroIndicatorReadDependencies = {}
): MacroIndicatorReadService {
  return {
    async read({ asOf }) {
      if (!macroIndicatorAsOfPolicy.canonicalUtcMillisPattern.test(asOf)) throw new Error('invalid asOf')
      const rows = MACRO_INDICATOR_CARD_KEYS.flatMap((metricKey) => rowsForMetric(repository, metricKey, asOf))
      const facts = resolveMacroIndicatorFacts(rows)
      // 官方序列优先于日历库的读数；读不到就把那一格标成「暂时读不到」，不退回旧值。
      const withOfficial = dependencies.readOfficialYoY === undefined
        ? facts
        : await Promise.all(facts.map(async (fact) => {
          const reading = await dependencies.readOfficialYoY!(fact.metricKey).catch((): FredYoYReading => ({ state: 'unavailable', seriesId: '', reason: 'read-failed' }))
          return applyOfficialYoY(fact, reading)
        }))
      if (dependencies.nextReleaseFor === undefined) return withOfficial
      return await Promise.all(withOfficial.map((fact) => withNextRelease(fact, dependencies, asOf)))
    }
  }
}

/**
 * 下一期：排期 + 那一期的盘口共识。
 *
 * 三件事分开说：
 * - 没有排期 → 不带 `next`（卡上走「暂无排期」），**不拿上一期凑**；
 * - 有排期、没接盘口 → 只带排期；
 * - 有盘口：读到盘就带值（含成交量），读失败标 `unreadable`（卡上说「暂时读不到」），
 *   确实没盘标 `no-market`（卡上说「暂无共识」）——这两种在读者眼里是两件事。
 */
async function withNextRelease(
  fact: MacroIndicatorCardFact,
  dependencies: MacroIndicatorReadDependencies,
  asOf: string
): Promise<MacroIndicatorCardFact> {
  const next = dependencies.nextReleaseFor!(fact.metricKey, asOf)
  if (next === undefined) return fact
  const schedule = { next: { period: next.period, releaseAt: next.releaseAt } }
  if (dependencies.readMarketConsensus === undefined) return { ...fact, ...schedule }
  let reading: MacroMarketConsensusReading
  try {
    reading = await dependencies.readMarketConsensus({ metricKey: fact.metricKey, ...next, asOf })
  } catch {
    reading = { state: 'unavailable', reason: 'read-failed' }
  }
  if (reading.state === 'ok') {
    return {
      ...fact,
      next: {
        ...next,
        consensus: Object.freeze({
          value: reading.value, provenance: 'market-implied' as const,
          asOf: reading.asOf, marketVolume: reading.marketVolume
        })
      }
    }
  }
  // 读失败与「没有盘」不能混：前者读者该知道是暂时读不到，后者是这个指标确实没有盘。
  return { ...fact, next: { ...next, consensusState: reading.reason === 'read-failed' ? 'unreadable' : 'no-market' } }
}

const unitByNarwhalUnit: Readonly<Record<string, 'percent' | 'thousands'>> = Object.freeze({
  percent: 'percent',
  thousands: 'thousands'
})

function rowsForMetric(
  repository: MacroIndicatorReadRepository,
  metricKey: MacroIndicatorCardKey,
  asOf: string
): readonly MacroIndicatorCardRow[] {
  const release = repository.readLatestReleaseForMetric({
    narwhalMeasure: narwhalMeasuresByMetricKey(metricKey)[0] ?? '',
    legacyIndicatorIds: legacyIndicatorIdsByMetricKey(metricKey),
    asOf
  })
  // 发布行**自己声明**的单位（即使这一期没有 actual，`unit` 仍在）优先；没有才看旧源原文的写法。
  const declaredUnit = release.narwhal === undefined ? undefined : unitOfMeasure(release.narwhal, metricKey)
  const legacyRows = release.legacy.map((row) => toLegacyRow(row, metricKey, declaredUnit))
  return release.narwhal === undefined
    ? legacyRows
    : [toNarwhalRow(release.narwhal, metricKey, release.legacy), ...legacyRows]
}

/**
 * 一次发布里**该指标**的那个值——一行只带一个 measure 的视角，所以单位、上期值不会串到别的指标上
 * （同一次非农发布里，失业率是百分比、新增就业是千人数）。
 *
 * `previousAsPublished` 取**旧源同一天那几行**的上期值，不用新源发布行的 `previous`：
 * 新源的 `previous` 是修订后的（非农 60），卡上要的是发布当时的（29）。
 */
function toNarwhalRow(
  release: NarwhalReleaseRow,
  metricKey: MacroIndicatorCardKey,
  legacy: readonly MacroCalendarLegacyMetricRow[]
): MacroIndicatorCardRow {
  const entry = release.values.find((value) => narwhalMeasureMetricKeys[value.measure] === metricKey)
  const value = parseSourceNumber(entry?.actual)
  const unit = entry?.unit === undefined ? undefined : unitByNarwhalUnit[entry.unit]
  const primaryMetricKey = release.values[0] === undefined ? undefined : narwhalMeasureMetricKeys[release.values[0].measure]
  const previousAsPublished = firstPreviousAsPublished(legacy)
  const period = periodOfLegacy(legacy)
  // 「预期」= 同一条发布里这个 measure 的 `consensus`；观测时刻用这次发布的 detectedAt。
  const consensus = parseSourceNumber(entry?.consensus)
  return {
    provider: 'narwhal',
    measureKeys: [metricKey],
    ...(primaryMetricKey === undefined ? {} : { primaryMetricKey }),
    ...(value === undefined ? {} : { measureValues: { [metricKey]: value } }),
    ...(previousAsPublished === undefined ? {} : { previousAsPublished }),
    ...(consensus === undefined ? {} : { consensus, consensusAsOf: release.detectedAt }),
    ...(period === undefined ? {} : { period }),
    ...(unit === undefined ? {} : { unit }),
    releasedAt: release.scheduledAt ?? `${release.scheduledDate}T00:00:00.000Z`
  }
}

function toLegacyRow(
  row: MacroCalendarLegacyMetricRow,
  metricKey: MacroIndicatorCardKey,
  declaredUnit: 'percent' | 'thousands' | undefined
): MacroIndicatorCardRow {
  const value = parseSourceNumber(row.actualDisplay)
  const previousAsPublished = parseSourceNumber(row.previousDisplay)
  const period = periodOfLegacy([row])
  const unit = declaredUnit ?? unitOfDisplay(row.actualDisplay) ?? unitOfDisplay(row.previousDisplay)
  return {
    provider: '0xrouter',
    measureKeys: [metricKey],
    primaryMetricKey: metricKey,
    ...(value === undefined ? {} : { value }),
    ...(previousAsPublished === undefined ? {} : { previousAsPublished }),
    ...(period === undefined ? {} : { period }),
    ...(unit === undefined ? {} : { unit }),
    releasedAt: row.scheduledAt
  }
}

/** 期次只从既有身份函数取：`2026-11-10` 那次 CPI 发布的身份属于 `2026-10`。 */
function periodOfLegacy(legacy: readonly MacroCalendarLegacyMetricRow[]): string | undefined {
  for (const row of legacy) {
    const identity = zeroXRouterCanonicalIdentity({
      countryCode: row.countryCode, indicatorId: row.indicatorId, scheduledAt: row.scheduledAt
    })
    if (identity !== undefined) return identity.periodKey
  }
  return undefined
}

/**
 * 上期值：旧源在**发布当时**给的那个数。
 *
 * 缺就是缺——不拿新源发布行的 `previous` 顶（那是修订值），也不回填 0。
 */
function firstPreviousAsPublished(legacy: readonly MacroCalendarLegacyMetricRow[]): number | undefined {
  for (const row of legacy) {
    const previous = parseSourceNumber(row.previousDisplay)
    if (previous !== undefined) return previous
  }
  return undefined
}

function unitOfMeasure(release: NarwhalReleaseRow, metricKey: string): 'percent' | 'thousands' | undefined {
  const value = release.values.find((entry: NarwhalReleaseValue) => narwhalMeasureMetricKeys[entry.measure] === metricKey)
  return value?.unit === undefined ? undefined : unitByNarwhalUnit[value.unit]
}

/**
 * 来源原文里的数：`"165"`、`"3.7%"`、`"+29K"`、`"-18"`。
 *
 * 解析不出就返回 undefined——**不把看不懂的字符串读成 0**。
 */
export function parseSourceNumber(display: string | undefined): number | undefined {
  if (display === undefined) return undefined
  const cleaned = display.replace(/[\s,%＋+]/g, '').replace(/[Kk]$/, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}

function unitOfDisplay(display: string | undefined): 'percent' | 'thousands' | undefined {
  if (display === undefined) return undefined
  if (display.includes('%')) return 'percent'
  return /[Kk]$/.test(display.trim()) ? 'thousands' : undefined
}
