/**
 * 「事件目录」弹框的筛选与分页：**纯函数**，与读口和渲染都无关。
 *
 * 口径（Chief 2026-11-16 拍板，产品经理定的匹配规则）：
 * - 名称框：**中文全名 / 中文简称 / 英文全名 / 英文简称，任一命中即算命中**；四个都为空时用
 *   `sourceLabel`（源原文名）兜底。英文不区分大小写；输入按空格拆词，**每个词可落在不同字段**，
 *   全部命中才算命中。不做拼音、不做编辑距离——那会搜出看起来无关的行，读者解释不了。
 * - 国家、重要性各自独立筛选：把国家并进名称框会让 `US` 命中所有美国事件，看着像名字匹配、
 *   其实是身份匹配，同一个结果两种解释。
 * - 名称框里**不拼接**字段：拼接会造出「中文名结尾 + 英文名开头」这种跨字段的假命中。
 */
export type CatalogRow = Readonly<{
  /** 稳定键：渲染 key 与去重都用它。 */
  key: string
  /** 当前界面语言下要显示的名字（简称优先，没有名表条目时是源原文名）。 */
  title: string
  /** 名称位是不是源原文名（那约 420 行）：要标注，读者才知道这条没有名表条目。 */
  titleIsSourceLabel: boolean
  /**
   * 参与名称匹配的**若干列**（中全/中简/英全/英简；四列都空时是源原文名那一列）。
   *
   * 收成「一组字符串」而不是四个具名字段，是因为**这一层不需要知道名字表长什么样**：
   * 名表只有一处（`marketCalendarDisplayNameTables.ts`），这里只是用它的内容做匹配。
   * 每个词必须落在**同一列**里命中——不拼接字段，拼接会造出「中文名结尾 + 英文名开头」的假命中。
   */
  names: readonly string[]
  countryCode?: string
  /** 国家显示名（与列表同一套回退：名字 → 原码 → 未知国家）。 */
  countryLabel: string
  /** 期间（`2026-M10` 这种；没有就不给）。 */
  period?: string
  /** 发布时刻（`HH:mm`，读者时区）；本月范围内有。 */
  time?: string
  /** 最近一次发布（期间 + 日期，已格式化）；没有就不给。 */
  lastRelease?: string
  /** 下次发布（已格式化）；没有就不给。 */
  nextRelease?: string
  importance?: 'high' | 'medium' | 'low'
}>

export type CatalogFilters = Readonly<{ name: string; country: string; importance: string }>

export const EMPTY_CATALOG_FILTERS: CatalogFilters = Object.freeze({ name: '', country: '', importance: '' })

/** 一个词命中：**某一列**包含它（英文折叠大小写）。 */
function matchesWord(row: CatalogRow, word: string): boolean {
  const needle = word.toLowerCase()
  return row.names.some((field) => field.toLowerCase().includes(needle))
}

/** 名称框：按空格拆词，每个词都要在某一个字段里命中（可以各自落在不同字段）。 */
export function matchesNameFilter(row: CatalogRow, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/u).filter((word) => word !== '')
  if (words.length === 0) return true
  return words.every((word) => matchesWord(row, word))
}

/** 国家框：按显示名或原码包含匹配（读者可能输入「美国」也可能输入 `US`）。 */
export function matchesCountryFilter(row: CatalogRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return row.countryLabel.toLowerCase().includes(needle) || (row.countryCode ?? '').toLowerCase().includes(needle)
}

export function filterCatalogRows(rows: readonly CatalogRow[], filters: CatalogFilters): readonly CatalogRow[] {
  return rows.filter((row) => matchesNameFilter(row, filters.name)
    && matchesCountryFilter(row, filters.country)
    && (filters.importance === '' || row.importance === filters.importance))
}

/**
 * 一页的数据。**页码超界时夹回最后一页**（筛选后行数变少、页码还停在第 5 页时，读者看到的
 * 是一张空表——那不是「没有结果」，是页码越界）。
 */
export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): Readonly<{ rows: readonly T[]; page: number; pageCount: number }> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const clamped = Math.min(Math.max(1, Math.trunc(page)), pageCount)
  const start = (clamped - 1) * pageSize
  return { rows: rows.slice(start, start + pageSize), page: clamped, pageCount }
}

/** 默认排序：**最近一次发布倒序**（没有发布日期的排最后；同日期按稳定键，避免等值乱序）。 */
export function sortCatalogRows(rows: readonly CatalogRow[]): readonly CatalogRow[] {
  return [...rows].sort((left, right) => {
    const a = left.lastRelease ?? ''
    const b = right.lastRelease ?? ''
    if (a !== b) {
      if (a === '') return 1
      if (b === '') return -1
      return b.localeCompare(a)
    }
    return left.key.localeCompare(right.key)
  })
}
