import {
  MACRO_INDICATOR_CARD_KEYS, legacyIndicatorIdsByMetricKey, narwhalMeasuresByMetricKey,
  resolveMacroIndicatorFacts, type MacroIndicatorCardFact, type MacroIndicatorCardKey, type MacroIndicatorCardRow
} from './macroIndicatorCardFacts'
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

export type MacroIndicatorReadService = Readonly<{
  /** 四个指标的事实；`asOf` 不是规范 UTC 时刻就抛——读不到不能画成「本月未发布」。 */
  read: (input: { asOf: string }) => readonly MacroIndicatorCardFact[]
}>

export function createMacroIndicatorReadService(repository: MacroIndicatorReadRepository): MacroIndicatorReadService {
  return {
    read({ asOf }) {
      if (!macroIndicatorAsOfPolicy.canonicalUtcMillisPattern.test(asOf)) throw new Error('invalid asOf')
      const rows = MACRO_INDICATOR_CARD_KEYS.flatMap((metricKey) => rowsForMetric(repository, metricKey, asOf))
      return resolveMacroIndicatorFacts(rows)
    }
  }
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
    ...(consensus === undefined ? {} : { consensus, consensusAsOf: release.detectedAt, consensusSourceName: 'Narwhal' }),
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
