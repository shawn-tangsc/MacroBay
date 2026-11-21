import {
  marketCalendarCountryAliases, marketCalendarCountryCodeExceptions
} from './marketCalendarCountryAliases'
import { germanSourceMetricMappings } from './marketCalendarGermanSourceMappings'
import { marketCalendarCountrySourceMappings } from './marketCalendarCountrySourceMappings'
import { zeroXRouterEventIdentities } from './marketCalendarEventIdentities'
import { classifyReleaseDay, type PublishWindow } from './marketCalendarPublishWindow'
import { zeroXRouterSourceMetricMappings } from './marketCalendarZeroXRouterSourceMappings'

/**
 * 跨源规范身份：源内码 → `metric_key` 的对照表。Narwhal 那张纯数据表搬到了
 * `marketCalendarNarwhalMeasureKeys.ts`（不同职责：那张表只管源内码对照，这里管身份怎么算）。
 *
 * 数据出处（只增不改，改一条就要重跑身份守卫）：
 * - `docs-private/iterations/0.4.4-calendar-sources/14-映射表-美国202611-新源.csv`（Narwhal 70 条）
 * - `docs-private/iterations/0.4.4-calendar-sources/14-映射表-美国202611-旧源.csv`（0xRouter 85 条）
 *
 * 红线：**名字绝不参与匹配**。这里的键是「换语言后不变」的源内码（Narwhal 的
 * `measure`、0xRouter 的 `indicator_id` 数字），映射表里那些人读文案只用于人工复核。
 * 对不上的一律 `unmapped`——不猜、不按相似度、不拿名字兜底。
 */


/** 0xRouter 的 `indicator_id`（已落库的 `indicator_id` 列）→ 规范指标键与期间规则。 */
/**
 * 期次取法。**事件型用 `event_date`**（用户 2026-11-17 定：事件身份 = 类型 + 日期）：
 * 一场活动一个身份。同月按 `month` 合并，会把一个月里的两场讲话并成一条、日期也并掉。
 */
/**
 * 期次规则（PRD R38 §3.1，2026-11-21 产品定）。
 *
 * 五种形状对应五条规则：`month`→`YYYY-MM`（上月）、`current_month`→`YYYY-MM`（**当月**，
 * 调查/景气类）、`quarter`→`YYYY-Qn`（上季）、`week_end`→`YYYY-MM-DD`（上一个截止日，
 * 标题「（至MMDD）」优先）、`event_date`→`YYYY-MM-DD`（当天，不合并）。
 *
 * **`current_month` 是单独声明，不是 `month` 的默认**：纽约联储制造业、费城联储、密歇根
 * 这类在发布月里发的是**当月值**，按「上月」会错记成上一期（11-17 发的 11 月值落成 2026-10）。
 * 声明没写清的先按 `month`（统计月），在映射清单里标待核，不许猜。
 */
export type ZeroXRouterPeriodRule = 'month' | 'current_month' | 'week_end' | 'quarter' | 'event_date'
/**
 * 「这一条的期次规则产品还在点名」——先按 §3.1 的现规则（统计月）处理，但**标记出来**，
 * 让后面的人一眼看出这是悬着的，不是我们忘了。产品给了口径就改成 `current_month` 并删标记。
 */
export type PeriodRuleReview = 'pending-product'
export type ZeroXRouterIdentityEntry = Readonly<{
  metricKey: string
  periodRule: ZeroXRouterPeriodRule
  periodRuleReview?: PeriodRuleReview
}>
export const zeroXRouterIndicatorIdentities: Readonly<Record<string, ZeroXRouterIdentityEntry>> = Object.freeze({
  '10098': { metricKey: 'US.SP_MANUFACTURING_PMI.SA.LEVEL', periodRule: 'current_month' },
  '9413': { metricKey: 'US.CONSTRUCTION_SPENDING.SA.MOM', periodRule: 'month' },
  '4013': { metricKey: 'US.ISM_MANUFACTURING.SA.LEVEL', periodRule: 'month' },
  '9260': { metricKey: 'US.ISM_MANUFACTURING_PRODUCTION.SA.LEVEL', periodRule: 'month' },
  '9258': { metricKey: 'US.ISM_MANUFACTURING_INVENTORIES.SA.LEVEL', periodRule: 'month' },
  '9256': { metricKey: 'US.ISM_MANUFACTURING_PRICES.SA.LEVEL', periodRule: 'month' },
  '9252': { metricKey: 'US.ISM_MANUFACTURING_EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '9259': { metricKey: 'US.ISM_MANUFACTURING_NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '10100': { metricKey: 'US.DURABLE_GOODS_EX_TRANSPORT.SA.MOM', periodRule: 'month' },
  '10106': { metricKey: 'US.DURABLE_GOODS_EX_DEFENSE.SA.MOM', periodRule: 'month' },
  '9417': { metricKey: 'US.REDBOOK_RETAIL_SALES.NONE.YOY', periodRule: 'week_end' },
  '10235': { metricKey: 'US.DURABLE_GOODS_ORDERS.SA.MOM', periodRule: 'month' },
  '10103': { metricKey: 'US.CORE_CAPEX_ORDERS.SA.MOM', periodRule: 'month' },
  '9436': { metricKey: 'US.FACTORY_ORDERS.SA.MOM', periodRule: 'month' },
  '10290': { metricKey: 'US.JOLTS_OPENINGS.SA.COUNT', periodRule: 'month' },
  '9424': { metricKey: 'US.API_CRUDE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9423': { metricKey: 'US.API_GASOLINE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9422': { metricKey: 'US.API_DISTILLATE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9831': { metricKey: 'US.API_CUSHING_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9420': { metricKey: 'US.MBA_PURCHASE_INDEX.NONE.LEVEL', periodRule: 'week_end' },
  '9418': { metricKey: 'US.MBA_REFINANCE_INDEX.NONE.LEVEL', periodRule: 'week_end' },
  '9419': { metricKey: 'US.MBA_APPLICATIONS.NONE.LEVEL', periodRule: 'week_end' },
  '9421': { metricKey: 'US.MBA_RATE_30Y.NONE.RATE', periodRule: 'week_end' },
  '9106': { metricKey: 'US.ADP.SA.CHANGE', periodRule: 'month' },
  '4022': { metricKey: 'US.TRADE_BALANCE.NONE.DIFF', periodRule: 'month' },
  '8791': { metricKey: 'US.EXPORTS.NONE.AMOUNT', periodRule: 'month' },
  '8792': { metricKey: 'US.IMPORTS.NONE.AMOUNT', periodRule: 'month' },
  '10260': { metricKey: 'US.SP_SERVICES_PMI.SA.LEVEL', periodRule: 'current_month' },
  '10263': { metricKey: 'US.SP_COMPOSITE_PMI.SA.LEVEL', periodRule: 'month' },
  '9264': { metricKey: 'US.ISM_SERVICES_EMPLOYMENT.SA.LEVEL', periodRule: 'month' },
  '9262': { metricKey: 'US.ISM_SERVICES_SUPPLIER_DELIVERIES.SA.LEVEL', periodRule: 'month' },
  '4014': { metricKey: 'US.ISM_SERVICES.SA.LEVEL', periodRule: 'month' },
  '9261': { metricKey: 'US.ISM_SERVICES_NEW_ORDERS.SA.LEVEL', periodRule: 'month' },
  '9265': { metricKey: 'US.ISM_SERVICES_PRICES.SA.LEVEL', periodRule: 'month' },
  '9268': { metricKey: 'US.ISM_SERVICES_INVENTORIES.SA.LEVEL', periodRule: 'month' },
  '9811': { metricKey: 'US.EIA_CRUDE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9917': { metricKey: 'US.EIA_CUSHING_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9809': { metricKey: 'US.EIA_DISTILLATE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9393': { metricKey: 'US.EIA_REFINERY_UTILIZATION.NONE.RATE', periodRule: 'week_end' },
  '9810': { metricKey: 'US.EIA_GASOLINE_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '9888': { metricKey: 'US.CHALLENGER_JOB_CUTS.NONE.YOY', periodRule: 'month' },
  '9433': { metricKey: 'US.CHALLENGER_JOB_CUTS.NONE.MOM', periodRule: 'month' },
  '9434': { metricKey: 'US.CHALLENGER_JOB_CUTS.NONE.COUNT', periodRule: 'month' },
  '8659': { metricKey: 'US.JOBLESS_CLAIMS_INITIAL.SA.COUNT', periodRule: 'week_end' },
  '10120': { metricKey: 'US.UNIT_LABOR_COSTS.SA.QOQ', periodRule: 'quarter' },
  '9251': { metricKey: 'US.JOBLESS_CLAIMS_CONTINUING.SA.COUNT', periodRule: 'week_end' },
  '9270': { metricKey: 'US.JOBLESS_CLAIMS_4W_AVERAGE.SA.AVERAGE', periodRule: 'week_end' },
  '10117': { metricKey: 'US.PRODUCTIVITY.SA.QOQ', periodRule: 'quarter' },
  '10293': { metricKey: 'US.GSCPI.NONE.LEVEL', periodRule: 'month' },
  '9425': { metricKey: 'US.EIA_NATURAL_GAS_STOCKS.NONE.CHANGE', periodRule: 'week_end' },
  '8656': { metricKey: 'US.NONFARM.SA.CHANGE', periodRule: 'month' },
  '4010': { metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodRule: 'month' },
  '9272': { metricKey: 'US.AHE.SA.MOM', periodRule: 'month' },
  '9824': { metricKey: 'US.PRIVATE_PAYROLLS.SA.CHANGE', periodRule: 'month' },
  '9275': { metricKey: 'US.AVERAGE_WEEKLY_HOURS.SA.LEVEL', periodRule: 'month' },
  '9827': { metricKey: 'US.PARTICIPATION_RATE.SA.RATE', periodRule: 'month' },
  '9273': { metricKey: 'US.MANUFACTURING_PAYROLLS.SA.CHANGE', periodRule: 'month' },
  '9920': { metricKey: 'US.UNEMPLOYMENT_U6.SA.RATE', periodRule: 'month' },
  '9274': { metricKey: 'US.AHE.NSA.YOY', periodRule: 'month' },
  '9940': { metricKey: 'US.MICHIGAN_SENTIMENT.NONE.LEVEL', periodRule: 'current_month' },
  '10264': { metricKey: 'US.MICHIGAN_INFLATION_1Y.NONE.LEVEL', periodRule: 'current_month' },
  '10267': { metricKey: 'US.MICHIGAN_INFLATION_5Y.NONE.LEVEL', periodRule: 'current_month' },
  '10114': { metricKey: 'US.MICHIGAN_EXPECTATIONS.NONE.LEVEL', periodRule: 'current_month' },
  '10111': { metricKey: 'US.MICHIGAN_CURRENT.NONE.LEVEL', periodRule: 'current_month' },
  '9851': { metricKey: 'US.BAKER_HUGHES_OIL_RIGS.NONE.COUNT', periodRule: 'week_end' },
  '9853': { metricKey: 'US.BAKER_HUGHES_GAS_RIGS.NONE.COUNT', periodRule: 'week_end' },
  '9852': { metricKey: 'US.BAKER_HUGHES_TOTAL_RIGS.NONE.COUNT', periodRule: 'week_end' },
  '9766': { metricKey: 'US.CONSUMER_CREDIT.SA.CHANGE', periodRule: 'month' },
  '9440': { metricKey: 'US.WHOLESALE_SALES.SA.MOM', periodRule: 'month' },
  '10110': { metricKey: 'US.WHOLESALE_INVENTORIES.SA.MOM', periodRule: 'month' },
  '10279': { metricKey: 'US.NFIB_OPTIMISM.NONE.LEVEL', periodRule: 'month' },
  '8639': { metricKey: 'US.CORE_CPI.NSA.YOY', periodRule: 'month' },
  '8637': { metricKey: 'US.CPI.NSA.YOY', periodRule: 'month' },
  '4002': { metricKey: 'US.CORE_CPI.SA.LEVEL', periodRule: 'month' },
  '8638': { metricKey: 'US.CORE_CPI.SA.MOM', periodRule: 'month' },
  '9105': { metricKey: 'US.CPI.SA.MOM', periodRule: 'month' },
  '9806': { metricKey: 'US.REAL_AHE.NONE.MOM', periodRule: 'month' },
  '4001': { metricKey: 'US.CPI.NSA.LEVEL', periodRule: 'month' },
  '9290': { metricKey: 'US.EXISTING_HOME_SALES.SA.MOM', periodRule: 'month' },
  '4019': { metricKey: 'US.EXISTING_HOME_SALES.SA.COUNT', periodRule: 'month' },
  '4032': { metricKey: 'US.FEDERAL_BUDGET.NONE.DIFF', periodRule: 'month' },
  '8653': { metricKey: 'US.PPI.NSA.YOY', periodRule: 'month' },
  '8652': { metricKey: 'US.PPI.SA.MOM', periodRule: 'month' },
  '8654': { metricKey: 'US.CORE_PPI.SA.MOM', periodRule: 'month' },
  '8655': { metricKey: 'US.CORE_PPI.NSA.YOY', periodRule: 'month' },
})

/**
 * 规范身份：`(country_code, metric_key, period_key)` 三列，无第四列。
 *
 * `variant`（初值/修正/终值）不进身份键——修正值是同一事件的另一个值，不是另一个事件。
 */
export type MarketCalendarCanonicalIdentity = Readonly<{
  countryCode: string; metricKey: string; periodKey: string
}>

/**
 * 国家码归一：**身份只用三位（ISO alpha-3）**，存储层写的是两位。
 *
 * 不归一就会出现「同一个国家两条身份」——这正是身份规范里「US 与 USA 并存」那条判红。
 */
const alpha3ByAlpha2: Readonly<Record<string, string>> = Object.freeze({
  US: 'USA', CA: 'CAN', DE: 'DEU', GB: 'GBR', JP: 'JPN', CN: 'CHN', EU: 'EUR'
})

export function toAlpha3Country(code: string): string {
  return alpha3ByAlpha2[code] ?? code
}

/**
 * 反向归一：`USA` → `US`（已经是 alpha-2 的原样返回）。
 *
 * 存储层两种写法并存（标准表里 `US` 522 行、`USA` 329 行，后者来自按 alpha-3 落库的旧源）。
 * 显示国家名用的名表以 alpha-2 为键——不归一的话，`USA` 那些行的国家名会是空的，
 * 而「空」看起来就像「这条没有国家」。
 */
/**
 * 是不是「**归不成两位**的码」——判定标准是**能不能归成两位**，不是长度是不是 2（Chief 2026-11-18）。
 *
 * 按长度判会把合法 ISO alpha-3（`JPN`/`CAN`/`CHN`）误判成未知码：它们能反查成 JP/CA/CN，
 * 真库里正是要归一的那 47 行——误判的后果不是「没归一」，而是**被当未知码跳过、行直接丢了**。
 *
 * 放在这里（而不是别名文件里）是**为了断开循环 import**：别名文件只放数据表，不引用任何实现。
 */
export function isUnknownCountryCode(code: string): boolean {
  if (marketCalendarCountryCodeExceptions.includes(code)) return false
  const alpha2 = toAlpha2Country(code)
  return alpha2 === code && !/^[A-Z]{2}$/.test(code)
}

export function toAlpha2Country(code: string): string {
  if (marketCalendarCountryAliases[code] !== undefined) return marketCalendarCountryAliases[code]!
  /**
   * 源给的三位写法里，有几个**不是 ISO alpha-3**，而是常见缩写或 IOC 码（`PHI` 是菲律宾的 IOC 码，
   * ISO 是 `PHL`）。库里实测到这几种：`FRA / ITA / AUS / PHI / SIN / INA`——补一张显式别名表，
   * 因为靠 alpha-3 反查永远命中不了它们，那 50 行就会一直是三位写法。
   */
  // 别名表**只在这里定义一次**（`marketCalendarCountryAliases`），写入端与清理脚本共用。
  if (marketCalendarCountryAliases[code] !== undefined) return marketCalendarCountryAliases[code]!
  for (const [alpha2, alpha3] of Object.entries(alpha3ByAlpha2)) {
    if (alpha3 === code) return alpha2
  }
  return code
}

/** 身份的可比较字符串形式，做 join 用；分隔符取 `|`，三个字段都不含它。 */
export function canonicalIdentityKey(identity: MarketCalendarCanonicalIdentity): string {
  return `${identity.countryCode}|${identity.metricKey}|${identity.periodKey}`
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

/** 参照月 = 发布日的上一个月。CPI 十月数据在十一月发布，身份属于十月。 */
function previousMonthKey(scheduledAt: string): string {
  const date = new Date(scheduledAt)
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}

/**
 * 周度期次：**标题里带「至MMDD / to MMDD」时用源给的截止日**，否则退回按发布日推的上一周末。
 *
 * 为什么要这条：日本那批周度标题自带 `（至0925）`，那是源给的统计区间端点；而
 * `previousWeekEndingKey` 是拿**发布时刻**倒推的，两者可能差几天，周度指标会串周。
 *
 * 三条保守规则（错了就退回原算法，绝不猜）：
 * - 年份按**发布年**，拼出来的日期晚于发布日 → 退一年；
 * - 拼出来比发布日早超过 **200 天** → 认为不可靠，退回；
 * - 解析不出 → 退回。
 * 只在 `week_end` 这一条路径生效，**美国既有周度（初请/EIA/MBA）标题没有这种端点，期次不变**。
 */
function weekEndKeyFor(scheduledAt: string, title: string | undefined): string {
  const fallback = previousWeekEndingKey(scheduledAt)
  if (title === undefined) return fallback
  const match = /[（(]\s*(?:至|to)\s*(\d{2})(\d{2})\s*[）)]/iu.exec(title)
  if (match === null) return fallback
  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return fallback
  const published = new Date(scheduledAt)
  const publishedDay = isoDate(new Date(Date.UTC(published.getUTCFullYear(), published.getUTCMonth(), published.getUTCDate())))
  const asThisYear = `${published.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const candidate = asThisYear > publishedDay ? `${published.getUTCFullYear() - 1}-${asThisYear.slice(5)}` : asThisYear
  const candidateDate = new Date(`${candidate}T00:00:00.000Z`)
  const publishedDate = new Date(`${publishedDay}T00:00:00.000Z`)
  if (Number.isNaN(candidateDate.getTime())) return fallback
  // 早于发布日 200 天以上视为不可靠（防「至0105」在年末发布时被判到一年以前）。
  if (publishedDate.getTime() - candidateDate.getTime() > 200 * 24 * 3600 * 1000) return fallback
  return candidate
}

/** 参照周 = 发布日之前**最近的那个周六**（当天是周六就是当天）。 */
function previousWeekEndingKey(scheduledAt: string): string {
  const date = new Date(scheduledAt)
  date.setUTCHours(0, 0, 0, 0)
  const back = (date.getUTCDay() + 1) % 7
  date.setUTCDate(date.getUTCDate() - back)
  return isoDate(date)
}

/** 参照季 = 发布日所在季度的**上一个季度**（GDP 初值十月末发布，身份是 Q3）。 */
function previousQuarterKey(scheduledAt: string): string {
  const date = new Date(scheduledAt)
  const quarter = Math.floor(date.getUTCMonth() / 3)
  const year = date.getUTCFullYear() - (quarter === 0 ? 1 : 0)
  const previous = quarter === 0 ? 3 : quarter - 1
  return `${year}-Q${previous + 1}`
}

/**
 * 0xRouter 一行的规范身份。
 *
 * `indicator_id` 不在映射表里 → `undefined`：这就是「这条没有指标身份」，讲话、会议、
 * 选举这类行都在这里。它们**不参与合并**，按原样从旧源出。
 */
export function zeroXRouterCanonicalIdentity(row: Readonly<{
  countryCode: string | null; indicatorId: string | null; scheduledAt: string
  /** 源标题（可选）：**只用于周度期次**——标题里带 `（至MMDD）`/`(to MMDD)` 时优先用它。 */
  title?: string
  /**
   * 该序列的**发布窗口**（从历史发布日现算，见 `marketCalendarPublishWindow`）。月/当月规则用它判
   * 「越窗但落在头 7 天」→ 上一期延迟/终值。不传就按声明规则直接算（老调用方行为不变）。
   */
  window?: PublishWindow
}>): MarketCalendarCanonicalIdentity | undefined {
  if (!row.countryCode || !row.indicatorId) return undefined
  // 两个来源的 id 命名空间分开：0xrouter 自己那张表是「按来源拆」的起点（迁移后新增）。
  // 同一个来源（0xrouter）下按**国家**分表：美国一张、德国一张，**按国家选表**。
  // 不做「三张表依次试」：那样一个德国 id 若挂在错误的国家下会照样解出身份，
  // 把国家字段的错变成身份层的错（德国 GfK 的 id 配上 US 会算出「美国 GfK」）。
  // 事件型先查（它们不是指标，也不按国家分表：一场讲话的身份是「类型 + 日期」+ 国家）。
  const entry = zeroXRouterEventIdentities[row.indicatorId] ?? (row.countryCode === 'DE'
    ? germanSourceMetricMappings[row.indicatorId]
    : zeroXRouterIndicatorIdentities[row.indicatorId] ?? zeroXRouterSourceMetricMappings[row.indicatorId]
      ?? marketCalendarCountrySourceMappings[row.indicatorId])
  if (!entry) return undefined
  // 事件型：期次就是那一场活动的日期（UTC 当天），不落到月，避免同月多场被并成一条。
  if (entry.periodRule === 'event_date') {
    return { countryCode: row.countryCode, metricKey: entry.metricKey, periodKey: row.scheduledAt.slice(0, 10) }
  }
  /**
   * 月/当月规则先过窗口：**越窗且落在发布月头 7 天 → 上一期的延迟/终值**；
   * 其它越窗 → 返回 `undefined`（调用方记 `unknown`、待核），**不许默认按当月**。
   * 这一步只对月粒度生效：季/周/事件各有自己的边界，混进来会把正常排期判成越窗。
   */
  if (entry.periodRule === 'month' || entry.periodRule === 'current_month') {
    const verdict = row.window === undefined ? 'in-window'
      : classifyReleaseDay(row.scheduledAt.slice(0, 10), row.window)
    /**
     * 越窗且不在头 7 天：**期次明确缺失**（`''`），身份照旧保留——调用方按已有的
     * `period-unresolved` 规则记未映射并跳过，不写 `unknown:` 空壳行，也不许默认按当月。
     */
    if (verdict === 'out-of-window') return { countryCode: row.countryCode, metricKey: entry.metricKey, periodKey: '' }
    const periodKey = verdict === 'late-previous' ? previousMonthKey(row.scheduledAt)
      : entry.periodRule === 'current_month' ? row.scheduledAt.slice(0, 7) : previousMonthKey(row.scheduledAt)
    return { countryCode: row.countryCode, metricKey: entry.metricKey, periodKey }
  }
  // 逐条写全、不写「否则就当季度」：多一种规则时，漏写的那一支会静默变成别的形状。
  const periodKey = entry.periodRule === 'week_end' ? weekEndKeyFor(row.scheduledAt, row.title)
    : entry.periodRule === 'quarter' ? previousQuarterKey(row.scheduledAt)
    : row.scheduledAt.slice(0, 10)
  return { countryCode: row.countryCode, metricKey: entry.metricKey, periodKey }
}

/**
 * 合并规则：**同一个规范身份只出一行，出 Narwhal 那一行；Narwhal 没有的身份，旧源的行照常出。**
 *
 * `narwhalKeys` 是这一期 Narwhal 已经占住的身份集合；旧源里身份在集合内的行被顶掉，
 * 身份为空（讲话/会议）或不在集合内的行全部保留。
 */
export function keepRowsNotCoveredByNarwhal<T extends { row: Readonly<{ countryCode: string | null
  indicatorId: string | null; scheduledAt: string }> }>(
  rows: readonly T[], narwhalKeys: ReadonlySet<string>
): readonly T[] {
  if (narwhalKeys.size === 0) return rows
  return rows.filter((item) => {
    const identity = zeroXRouterCanonicalIdentity(item.row)
    return identity === undefined || !narwhalKeys.has(canonicalIdentityKey(identity))
  })
}

/**
 * Narwhal 一行的规范身份由**写入端**决定，读取端只认它写下的 `candidate_key`。
 *
 * 形状（写入端按此拼，读取端按此解）：
 *   `["narwhal", <descriptor>, <locale>, ["<country>|<metric_key>|<period_key>", <序号>]]`
 *
 * 方括号里那一段 `country|metric|period` 就是规范身份；写入端**算不出时不许编一个**，
 * 而是写来源自己的 `release_id`——那种行读回来就是 `unmapped`，不进日历（行仍在库里）。
 */
export function narwhalCanonicalIdentityKey(candidateKey: string): string | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(candidateKey) } catch { return undefined }
  if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== 'narwhal') return undefined
  // `source_event_id` 是**字符串**列，写进去的是 `["<token>",1]` 的 JSON 文本，所以这里可能
  // 拿到字符串也可能拿到数组（老行/新行两种宽度都认）。
  let inner: unknown = parsed[3]
  if (typeof inner === 'string') {
    try { inner = JSON.parse(inner) } catch { return undefined }
  }
  if (!Array.isArray(inner) || inner.length !== 2 || typeof inner[0] !== 'string' ||
    typeof inner[1] !== 'number' || !Number.isSafeInteger(inner[1]) || inner[1] <= 0) return undefined
  const plain = decodeNarwhalIdentityToken(inner[0])
  if (plain === undefined) return undefined
  const parts = plain.split('|')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined
  const [countryCode, metricKey, periodKey] = parts as [string, string, string]
  return canonicalIdentityKey({ countryCode, metricKey, periodKey })
}

/**
 * 写入端：把身份串编成 `sourceEventId` 的第一段。
 *
 * 存储层对 `source_event_id` 的字符集是 `[A-Za-z0-9_-]`（`candidate_key` 要能当索引键），
 * 而规范身份里有 `.` 和 `|`，所以这一段是 **base64url 编码**，读侧解回来。`releaseId`
 * 也在其中（算不出身份时它就是来源自己的 id）。
 */
export function narwhalSourceEventIdForIdentity(canonical: MarketCalendarCanonicalIdentity): string {
  return JSON.stringify([encodeIdentityToken(`${canonical.countryCode}|${canonical.metricKey}|${canonical.periodKey}`), 1])
}

/** 事件型身份：`(国家, 类型, 时刻)`，同样编码后写进 `sourceEventId`。 */
export function narwhalEventSourceEventId(countryCode: string, eventKind: string, at: string): string {
  return JSON.stringify([encodeIdentityToken(`${countryCode}|${eventKind}|${at}`), 1])
}

export function encodeIdentityToken(plain: string): string {
  return Buffer.from(plain, 'utf8').toString('base64url')
}

/** 反过来解：解不出、或解出来的形状不是三段，就是 `unmapped`。 */
export function decodeNarwhalIdentityToken(token: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(token)) return undefined
  try {
    const plain = Buffer.from(token, 'base64url').toString('utf8')
    return plain.includes('|') ? plain : undefined
  } catch { return undefined }
}
