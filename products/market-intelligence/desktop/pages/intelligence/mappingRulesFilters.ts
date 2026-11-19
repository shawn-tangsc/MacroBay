/**
 * 码表 / 未映射 / 事件三个页签的**筛选与派生**（纯函数，零 React）。
 *
 * 单独成文件的两个理由：
 * 1. 弹框已经很长，而这些逻辑与渲染无关——每个 useMemo 原本都带着一段「为什么这样筛」的注释，
 *    混在 JSX 之间既读不出、也容易被下一次改动顺手破坏；
 * 2. **口径只写在这里**：官网页三档判定、星级的选项写法、同一筛选内部是「或」而筛选之间是「且」，
 *    这些是读者看得见的规则。放在纯函数里，用例可以直接钉，不必挂载整个弹框。
 *
 * 三条原样保留的口径（别在这里改）：
 * - 官网页三档：`not-built`/`retired` 是「决定不补」，不是「待补」——两者必须分开；
 * - 分级选项写「★★★ 一级」（星级 + 文字），与导出同一写法；
 * - 码表默认按数据量降序，同数量按码名（空壳不能占第一屏）。
 */
import type { UnmappedSourceIdRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { CodeTableRead, CodeTableReadRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import type { CalendarEventListRead, CalendarEventRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'

/** 下拉项：`value` 是判定值，`label` 是读者看到的字。 */
export type MappingRuleOption = Readonly<{ value: string; label: string }>

export const has = (value: string | null | undefined): value is string => typeof value === 'string' && value !== ''

/** 搜索命中：空搜索词恒命中；否则任一列包含该词即可。 */
export function matchesNeedle(needle: string, values: readonly (string | null | undefined)[]): boolean {
  return needle === '' || values.some((value) => has(value) && value.toLowerCase().includes(needle))
}

/**
 * 官网页三档，**只有这一处判定**：列里的显示与筛选选项都走它。
 *
 * `not-built`/`retired` 是「决定不补」，不是「待补」——它们与「还没核到」必须分开，
 * 否则读者会把「不打算建页」当成「等我们补」。
 */
export function officialStateOf(row: CodeTableReadRow): 'checked' | 'pending' | 'none' {
  if (row.status === 'not-built' || row.status === 'retired') return 'none'
  return 'pending' in row.officialSource ? 'pending' : 'checked'
}

/**
 * 国家选项：从**各自那一页的行**派生，码表与事件各算各的（混了会筛出空结果）。
 * 事件类型码没有国家：这一档写「—」，不写成「未知国家」。
 */
export function countryOptionsFrom(rows: readonly { countryName: string | null }[]): MappingRuleOption[] {
  const seen = new Set<string>()
  for (const row of rows) seen.add(row.countryName ?? '—')
  return [...seen].sort((left, right) => left.localeCompare(right)).map((name) => ({ value: name, label: name }))
}

/** 官网页选项：只列当前表里真实出现过的档，与列同义。 */
export function officialOptionsFrom(
  codes: CodeTableRead | undefined,
  states: Readonly<Record<'checked' | 'pending' | 'none', string>>
): MappingRuleOption[] {
  if (codes?.state !== 'available') return []
  const seen = new Set<string>()
  for (const row of codes.rows) seen.add(officialStateOf(row))
  const order = ['checked', 'pending', 'none'] as const
  return order.filter((key) => seen.has(key)).map((key) => ({ value: key, label: states[key] }))
}

/**
 * 分级选项：只列**当前表里真实出现过**的档位，写法是「★★★ 一级」——星级 + 文字（用户 2026-11-18）。
 * 只写星星时，读者照着「一级」两个字在选项里找，会以为看不到一级。
 */
export function tierOptionsFrom(
  codes: CodeTableRead | undefined,
  stars: Readonly<Record<'1' | '2' | '3' | 'other', string>>,
  names: Readonly<Record<'1' | '2' | '3' | 'other', string>>
): MappingRuleOption[] {
  if (codes?.state !== 'available') return []
  const seen = new Set<string>()
  for (const row of codes.rows) seen.add(row.tier === null ? 'other' : String(row.tier))
  const order = ['1', '2', '3', 'other'] as const
  return order.filter((key) => seen.has(key))
    .map((key) => ({ value: key, label: `${stars[key]} ${names[key]}`.trim() }))
}

export type CodeRowFilters = Readonly<{
  needle: string
  countries: readonly string[]
  tiers: readonly string[]
  officials: readonly string[]
  onlyWithData: boolean
}>

/**
 * 码表行。**同一筛选内部是「或」，两个筛选之间是「且」**（用户 2026-11-18）；
 * 默认按数据量降序（860 个码里近 290 个一行数据都没有，空壳不能占第一屏），同数量按码名。
 */
export function filterCodeRows(codes: CodeTableRead | undefined, filters: CodeRowFilters): CodeTableReadRow[] {
  if (codes?.state !== 'available') return []
  const rows = codes.rows
    .filter((row) => matchesNeedle(filters.needle, [row.code, row.names.zhFull, row.names.enFull]))
    .filter((row) => filters.countries.length === 0 || filters.countries.includes(row.countryName ?? '—'))
    .filter((row) => filters.tiers.length === 0
      || filters.tiers.includes(row.tier === null ? 'other' : String(row.tier)))
    .filter((row) => filters.officials.length === 0 || filters.officials.includes(officialStateOf(row)))
    .filter((row) => !filters.onlyWithData || row.releaseRowCount > 0)
  return [...rows].sort((left, right) =>
    right.releaseRowCount - left.releaseRowCount || left.code.localeCompare(right.code))
}

/** 未映射行：搜索词 + 原因两档。 */
export function filterUnmappedRows(
  view: MappingRulesRead | undefined,
  filters: Readonly<{ needle: string; reason: string }>
): readonly UnmappedSourceIdRow[] {
  if (view?.state !== 'available') return []
  return view.unmapped
    .filter((row) => matchesNeedle(filters.needle, [row.sourceId, row.sampleLabel, row.sampleLabelEn]))
    .filter((row) => filters.reason === '' || row.reason === filters.reason)
}

/**
 * 事件行：**保留接口返回的顺序**（读口已按活动时间倒序），只做搜索与国家筛选。
 * 不加原因、不加分级、不加「只看有数据的」——那三样对事件没有意义。
 */
export function filterEventRows(
  events: CalendarEventListRead | undefined,
  filters: Readonly<{ needle: string; countries: readonly string[] }>
): readonly CalendarEventRow[] {
  if (events?.state !== 'available') return []
  return events.rows
    .filter((row) => matchesNeedle(filters.needle, [row.title, row.titleEn, row.countryName, row.countryCode]))
    .filter((row) => filters.countries.length === 0 || filters.countries.includes(row.countryName ?? '—'))
}

/** 原因选项：第一项是「全部」，其余只列当前表里真实出现过的原因。 */
export function reasonOptionsFrom(
  view: MappingRulesRead | undefined,
  allLabel: string,
  reasons: Readonly<Record<string, string>>
): MappingRuleOption[] {
  if (view?.state !== 'available') return []
  const seen = new Set(view.unmapped.map((row) => row.reason))
  return [{ value: '', label: allLabel },
    ...[...seen].sort().map((value) => ({ value, label: reasons[value] ?? value }))]
}