import type { EconomicCalendarText } from './economicCalendarText'

/**
 * 事件说明的「族 → 概念键」映射（R36 #34「说明文案」那一半）。
 *
 * 文案本体在产品文案表（`productText.ts` 的 `pages.intelligence.portal.calendar.explanations`，
 * 中英各一份，产品审定稿 `docs-private/iterations/r36-calendar-event-enrichment/04-event-explanations-final.md`）；
 * 这里只回答「这条事件该读哪一段」。
 *
 * 三条规矩，都来自那张稿子 §1：
 * 1. **按概念取键，不按族名各写一份**：四对同一份数据的族（GDP/REAL_GDP、PCE/PCE 物价、
 *    核心 PCE 两族、个人支出两族）共用一段。它们的**数据行**不合并——合并会藏掉一条口径。
 * 2. **水平不是增长率**：`ANNUM_REAL_GDP` 报的是总量水平，单独一个键。让它共用增长率那段，
 *    等于给读「水平」的人讲「环比折年率」。
 * 3. **利率决议按「国家 × 族」解**：欧美日三家的 `POLICY_RATE` 是三个键；别辖区的同名族
 *    **没有登记**就不给键——不拿欧美日那三段顶上（那是「按名字猜」）。
 *
 * 取不到键的族整段不显示：调用方拿到 `undefined` 就什么都不画——不留空行、不写兜底句。
 */

/** 概念键的闭集＝文案表那张表的键。加一个键要三处同笔：这里、中英文案、覆盖它的族。 */
export const calendarEventExplanationKeys = [
  'cpi', 'core-cpi', 'nonfarm', 'unemployment', 'unemployment-u6',
  'average-hourly-earnings', 'real-average-hourly-earnings', 'average-weekly-hours',
  'participation-rate', 'private-payrolls', 'manufacturing-payrolls', 'government-payrolls',
  'fomc', 'gdp-real-growth', 'gdp-real-level', 'gdp-deflator', 'final-sales',
  'pce-price', 'core-pce-price', 'personal-income', 'personal-spending', 'real-personal-spending',
  'policy-rate-emu', 'policy-rate-gb', 'policy-rate-jp'
] as const

export type CalendarEventExplanationKey = (typeof calendarEventExplanationKeys)[number]

/**
 * 美国族 → 概念键。**只列登记过的族**：中档族第一批不写文案，查不到就是没有。
 * 四对共用的两个族名分别指向同一个键——这是映射，不是复制第二段文字。
 */
const usFamilyKeys: Readonly<Record<string, CalendarEventExplanationKey>> = Object.freeze({
  CPI: 'cpi',
  CORE_CPI: 'core-cpi',
  NONFARM: 'nonfarm',
  UNEMPLOYMENT: 'unemployment',
  UNEMPLOYMENT_U6: 'unemployment-u6',
  AHE: 'average-hourly-earnings',
  REAL_AHE: 'real-average-hourly-earnings',
  AVERAGE_WEEKLY_HOURS: 'average-weekly-hours',
  PARTICIPATION_RATE: 'participation-rate',
  PRIVATE_PAYROLLS: 'private-payrolls',
  MANUFACTURING_PAYROLLS: 'manufacturing-payrolls',
  GOVERNMENT_PAYROLLS: 'government-payrolls',
  FOMC: 'fomc',
  GDP: 'gdp-real-growth',
  REAL_GDP: 'gdp-real-growth',
  ANNUM_REAL_GDP: 'gdp-real-level',
  GDP_DEFLATOR: 'gdp-deflator',
  FINAL_SALES: 'final-sales',
  PCE: 'pce-price',
  PERSONAL_CONSUMPTION_EXPENDITURE_PRICE: 'pce-price',
  CORE_PCE: 'core-pce-price',
  CORE_PERSONAL_CONSUMPTION_EXPENDITURE_PRICE: 'core-pce-price',
  PERSONAL_INCOME: 'personal-income',
  PERSONAL_SPENDING: 'personal-spending',
  PERSONAL_CONSUMPTION_EXPENDITURE: 'personal-spending',
  ACTUAL_PERSONAL_CONSUMPTION_EXPENDITURE: 'real-personal-spending'
})

/** 利率决议：辖区 → 键。没有登记的辖区（含今天合法存在的其它辖区）不给键。 */
const policyRateKeys: Readonly<Record<string, CalendarEventExplanationKey>> = Object.freeze({
  EMU: 'policy-rate-emu',
  GB: 'policy-rate-gb',
  JP: 'policy-rate-jp'
})

/**
 * 指标码（`US.CPI.NSA.YOY`）→ 概念键；没有登记就 `undefined`。
 *
 * 只认规范指标码的前两段（辖区、族）。**不按标题猜、不做大小写归一、不给缩写起别名**：
 * 猜错一次，读者看到的是一段不相关的说明，比没有说明更糟。
 */
export function calendarEventExplanationKeyFor(eventNameKey: string | undefined): CalendarEventExplanationKey | undefined {
  if (eventNameKey === undefined || eventNameKey.length === 0) return undefined
  const [countryCode, family] = eventNameKey.split('.')
  if (countryCode === undefined || family === undefined || family.length === 0) return undefined
  if (family === 'POLICY_RATE') return policyRateKeys[countryCode]
  // 除利率决议外，文案只登记了美国辖区的族：别辖区的同名族（EMU CPI 等）不拿美国那段顶上。
  if (countryCode !== 'US') return undefined
  return usFamilyKeys[family]
}

/**
 * 官方日历那条路的标题键（`cpi` / `nonfarm-payrolls`…）→ 概念键。
 *
 * 官方四个源（Fed / BLS / BEA）的标题键是**另一套身份**，不是指标码；产品 2026-11-25 定了接，
 * 文案不新增——同一份发布读同一段。`unknown` 与未列标题键不映射：讲话、会议这类行没有说明。
 */
const officialTitleKeys: Readonly<Record<string, CalendarEventExplanationKey>> = Object.freeze({
  cpi: 'cpi',
  'core-cpi': 'core-cpi',
  'nonfarm-payrolls': 'nonfarm',
  unemployment: 'unemployment',
  'average-hourly-earnings': 'average-hourly-earnings',
  pce: 'pce-price',
  'core-pce': 'core-pce-price',
  gdp: 'gdp-real-growth',
  fomc: 'fomc'
})

/**
 * 官方标题键 → 概念键；**只对 `(titleKey, US)` 生效**。
 *
 * 标题键本身不分国家：将来出现带 `cpi` 键的英国 CPI 行，那段第一句写着「美国劳工统计局」，
 * 拿它顶上就是把错的机构写给读者。所以辖区不是可选项——非美国一律 `undefined`（整段不出现）。
 * `unknown`、空串、未列标题键同理，不做「名字里含 CPI 就给」这类模糊匹配。
 */
export function calendarEventOfficialExplanationKeyFor(
  titleKey: string | undefined,
  countryCode: string | undefined
): CalendarEventExplanationKey | undefined {
  if (countryCode !== 'US') return undefined
  if (titleKey === undefined || titleKey.length === 0) return undefined
  return officialTitleKeys[titleKey]
}

/**
 * 这条事件的三段说明，顺序是「是什么 → 为什么值得看 → 看哪里」；没有登记就是 `undefined`。
 *
 * 文案从调用方传进来的那一份语言表读（`EconomicCalendarText['explanations']`），这里不持有
 * 第二份句子，也不做语言回退——缺一段就当没有这一段。
 */
export function calendarEventExplanation(
  eventNameKey: string | undefined,
  explanations: EconomicCalendarText['explanations']
): readonly [string, string, string] | undefined {
  const key = calendarEventExplanationKeyFor(eventNameKey)
  if (key === undefined) return undefined
  const paragraphs = explanations[key]
  if (paragraphs === undefined) return undefined
  return [paragraphs.what, paragraphs.why, paragraphs.watch]
}

/** 官方标题键那条路的三段说明；官方与市场读同一份文案，缺一段就当没有这一段。 */
export function calendarEventOfficialExplanation(
  titleKey: string | undefined,
  countryCode: string | undefined,
  explanations: EconomicCalendarText['explanations']
): readonly [string, string, string] | undefined {
  const key = calendarEventOfficialExplanationKeyFor(titleKey, countryCode)
  if (key === undefined) return undefined
  const paragraphs = explanations[key]
  if (paragraphs === undefined) return undefined
  return [paragraphs.what, paragraphs.why, paragraphs.watch]
}
