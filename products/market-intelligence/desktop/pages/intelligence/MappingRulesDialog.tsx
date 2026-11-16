import { useMemo, useState } from 'react'
import { Button, Input, Pagination, Select, Table } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'
import { Tabs } from '@platform/ui/components/tabs'
import type { ChoiceItem } from '@platform/ui/components/choice/choiceItem'

import type {
  MappingRuleRow, MappingRulesRead, UnmappedSourceIdRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import { buildXlsx } from '@platform/files/export/xlsx'
import { exportFileName, mappedExportRows, sampleText, unmappedExportRows } from './mappingRulesExport'
import {
  expandToFamily, filterMappedByTier, sortMappedRules, tierKeyOf, type TierFilter, type TierKey
} from './mappingRulesView'
import { MetricNameText } from '../../shared/MetricNameText'

/**
 * 「映射规则」弹框：**两个页签**（已映射 / 未映射），筛选框在页签上方、两段共用。
 *
 * 用户 2026-11-16：两段不要挤在同一屏，左上角给 tab 切换。
 *
 * 口径：
 * - 条数用读口 `counts`，前端不自己数；
 * - **筛选词跨页签保留**，但**各自页码独立**，切换页签回到第 1 页（否则会停在越界页）；
 * - 分页条固定在弹框底部，只换表格内容，页签与筛选不跟着滚；
 * - `officialUrl` 为 `null` 时格子空着（不写「无公开页」），但**列一直在**。
 */
export type MappingRulesText = Readonly<{
  title: string
  filter: string
  mapped: string
  unmapped: string
  mappedEmpty: string
  unmappedEmpty: string
  unavailable: string
  columns: Readonly<{ sourceId: string; metricKey: string; name: string; tier: string; periodRule: string; basis: string; official: string; rows: string }>
  /** 分级的四个说法；`null` 显示 `other`（未分级），**不空着**。 */
  tiers: Readonly<Record<'1' | '2' | '3' | 'other', string>>
  unmappedColumns: Readonly<{ sourceId: string; rows: string; sample: string }>
  /** 第三个页签：进来就带指标码、不需要规则的指标。 */
  /** 子项归属小字里的「子项」两个字（可见文案，不写在组件里）。 */
  childSuffix: string
  tabMapped: string
  tabUnmapped: string
  tabsAria: string
  exportLabel: string
  exportEmpty: string
  /** 导出按钮旁那句：导出的是全部行，与当前筛选无关。 */
  exportAllNote: string
  /** 页签下面那句（带 `{count}`）：本表只统计指标，事件数量从读口来。 */
  eventScopeNote: string
  /** 分级筛选器的占位（与「按国家筛选」同一种选择器）；选项复用 `tiers` 四档。 */
  tierFilter: string
  /** 导出文件里的三个工作表名。 */
  sheetMapped: string
  sheetUnmapped: string
}>

const PAGE_SIZES = [20, 50, 100] as const
/** 分级筛的四个选项，顺序就是读者看到的顺序：一、二、三、未分级。 */
const TIER_OPTIONS: readonly TierKey[] = ['1', '2', '3', 'other']
const has = (value: string | null | undefined): value is string => typeof value === 'string' && value !== ''

/** 地址太长时省略中间；`title` 保留全址，悬停能看到。 */
function shortUrl(value: string): string {
  if (value.length <= 56) return value
  return `${value.slice(0, 34)}…${value.slice(-18)}`
}

export function MappingRulesDialog({ open, onClose, text, view, onRetry }: Readonly<{
  open: boolean
  onClose: () => void
  text: MappingRulesText
  view: MappingRulesRead | undefined
  onRetry?: () => void
}>): React.ReactElement {
  const [query, setQuery] = useState('')
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [tab, setTab] = useState<'mapped' | 'unmapped'>('mapped')
  const [mappedPage, setMappedPage] = useState(1)
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const needle = query.trim().toLowerCase()
  const hit = (values: readonly (string | null | undefined)[]): boolean =>
    needle === '' || values.some((value) => has(value) && value.toLowerCase().includes(needle))
  /** 母指标的中文名：用来给子项写归属小字。查不到的母码不编名字，只留「子项」两个字。 */
  const parentNameOf = (metricKey: string): string | null => {
    if (view?.state !== 'available') return null
    const row = view.mapped.find((entry) => entry.metricKey === metricKey)
    return row?.names?.zh ?? null
  }
  /** 子项的归属小字：`母指标名 · 子项`；母名查不到就只写「子项」，不拿母码冒充名字。 */
  const ownerTextOf = (row: Readonly<{ parentMetricKey?: string | null; kind?: 'parent' | 'child' }>): string | null => {
    if (row.kind !== 'child' || row.parentMetricKey == null) return null
    const parentName = parentNameOf(row.parentMetricKey)
    return parentName === null ? text.childSuffix : `${parentName} · ${text.childSuffix}`
  }
  /**
   * 已映射：筛选词 + 分级筛 → **父带子** → 按族分组。
   * 排序是**读者可见的顺序**，导出也用这一份——两边顺序一致，不会「屏幕上一个样、文件里另一个样」。
   */
  const mapped = useMemo(() => {
    if (view?.state !== 'available') return []
    const candidates = view.mapped.filter((row) =>
      hit([...row.sourceIds, row.metricKey, row.basis, row.officialUrl, row.names?.zh, row.names?.en]))
    return sortMappedRules(filterMappedByTier(expandToFamily(view.mapped, candidates), tierFilter))
  }, [view, needle, tierFilter])
  const unmapped = useMemo(() => (view?.state === 'available' ? view.unmapped.filter((row) =>
    hit([row.sourceId, row.sampleLabel, row.sampleLabelEn])) : []), [view, needle])
  /**
   * **导出的全量**（用户 2026-11-17）：不管筛选框里输的是什么、分级选的是哪一档，导出的都是整张表。
   *
   * 读者点「导出」多半是要去核对总量，不是要一份「我刚筛过的那几行」；而文件一旦带上筛选结果，
   * 同一个按钮在同一天会给出内容不同的文件，事后没人说得清哪份是对的。顺序仍与界面同一把尺子。
   */
  const fullMapped = useMemo(() => (view?.state === 'available' ? sortMappedRules(view.mapped) : []), [view])
  const fullUnmapped = useMemo(() => (view?.state === 'available' ? view.unmapped : []), [view])
  const counts = view?.state === 'available' ? view.counts : { mapped: 0, unmapped: 0, unmappedRows: 0 }
  /**
   * 页签下面那句：解释「未映射少了、已映射没涨」。数字**只从读口取**（`counts.eventIdentities`），
   * 缺这个数就不显示这句话——写死一个数字，等于让界面替数据说话。
   */
  const eventCount = view?.state === 'available' ? view.counts.eventIdentities : undefined
  const eventScopeNote = eventCount === undefined
    ? null
    : <p className="mi-catalog__note" data-event-scope>
      {text.eventScopeNote.replace('{count}', String(eventCount))}
    </p>
  const items: readonly ChoiceItem[] = [
    { value: 'mapped', labelKey: 'tabMapped', labelParams: { count: String(counts.mapped) } },
    { value: 'unmapped', labelKey: 'tabUnmapped', labelParams: { count: String(counts.unmapped) } }
  ]
  const copy: Readonly<Record<string, string>> = { tabMapped: text.tabMapped, tabUnmapped: text.tabUnmapped }

  const mappedPanel = <>
    {eventScopeNote}
    {mapped.length === 0
      ? <p className="mi-catalog__note">{text.mappedEmpty}</p>
    : <Table<MappingRuleRow> size="small" rowKey="metricKey" pagination={false}
      dataSource={paged(mapped, mappedPage, pageSize)}
      columns={[
        {
          // 一个码一行，认得它的源内 id 全列出来；**空 = 它本来就是码身份进来的**（那两格空着，
          // 不是「没读到」——它没有 id 可写）。
          title: text.columns.sourceId, dataIndex: 'sourceIds', className: 'mi-catalog__cell-nowrap',
          render: (value: readonly string[]) => value.join(' · ')
        },
        { title: text.columns.metricKey, dataIndex: 'metricKey', className: 'mi-catalog__cell-nowrap' },
        {
          // 中文名为主语、英文名小字灰字跟在后面，子项再带归属小字（`母指标名 · 子项`）。
          // 没有名表条目就空着，不拿指标码拼假英文名——三处共用一个组件，规则不各写一套。
          title: text.columns.name, dataIndex: 'names',
          render: (value: MappingRuleRow['names'], row) =>
            <MetricNameText zh={value?.zh} en={value?.en} owner={ownerTextOf(row)} />
        },
        {
          // 分级直接读读口的 `tier`（分级表只有一处）；`null` 显示「未分级」，不空着。
          title: text.columns.tier, dataIndex: 'tier', className: 'mi-catalog__cell-nowrap',
          render: (value: 1 | 2 | 3 | null) => text.tiers[tierKeyOf(value)]
        },
        { title: text.columns.periodRule, dataIndex: 'periodRule', className: 'mi-catalog__cell-nowrap',
          render: (value: string | null) => value ?? '' },
        { title: text.columns.basis, dataIndex: 'basis', width: 180, render: (value: string | null) => value ?? '' },
        {
          title: text.columns.official, dataIndex: 'officialUrl', width: 380,
          // 用户要的是**地址本身**（去求证、去复制），不是「官方 ↗」按钮。
          render: (value: string | null) => has(value)
            ? <a href={value} target="_blank" rel="noreferrer" title={value} data-official
              className="mi-catalog__url">{shortUrl(value)}</a>
            : null
        },
        // 这条规则在库里实际覆盖多少行：0 也显示（0 是事实，空着会被当成「没读」）。
        { title: text.columns.rows, dataIndex: 'rowCount', className: 'mi-catalog__cell-nowrap',
          render: (value: number) => String(value) }
      ]} />}
  </>

  const unmappedPanel = <>
    {eventScopeNote}
    {unmapped.length === 0
      ? <p className="mi-catalog__note">{text.unmappedEmpty}</p>
    : <Table<UnmappedSourceIdRow> size="small" rowKey="sourceId" pagination={false}
      dataSource={paged(unmapped, unmappedPage, pageSize)}
      columns={[
        { title: text.unmappedColumns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.rows, dataIndex: 'rowCount', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.sample, dataIndex: 'sampleLabel', render: (_value: string | null, row) => sampleText(row) }
      ]} />}
  </>

  const body = view === undefined
    ? <StateView state="loading" />
    : view.state !== 'available'
      // 读不到是错误态：**不许**画成两张空表（那读者会以为「一条规则都没有」）。
      ? <StateView state="error" reasonCode="unreadable"
        action={{ labelKey: 'ui.state.action.retry', onSelect: () => onRetry?.() }} />
      : <Tabs items={items} value={tab} onChange={(value) => {
        const next = value === 'unmapped' ? 'unmapped' : 'mapped'
        setTab(next)
        // 切换页签回到第 1 页：筛选词保留，但页码各自独立，停在上一个页签的页码会越界成空表。
        if (next === 'mapped') setMappedPage(1)
        else setUnmappedPage(1)
      }} ariaLabelKey="tabsAria" resolveText={(key) => copy[key] ?? key}
        panels={{
          mapped: <section data-mapping-section="mapped">{mappedPanel}</section>,
          unmapped: <section data-mapping-section="unmapped">{unmappedPanel}</section>
        }} />

  const activeTotal = tab === 'mapped' ? mapped.length : unmapped.length
  const activePage = tab === 'mapped' ? mappedPage : unmappedPage
  const setActivePage = (next: number): void => {
    if (tab === 'mapped') setMappedPage(next)
    else setUnmappedPage(next)
  }

  return <Modal open={open} width="maximum" titleKey="mappingRulesTitle"
    resolveText={(key) => key === 'mappingRulesTitle' ? text.title : key}
    onClose={onClose} className="mi-catalog-dialog">
    <div className="mi-catalog__body">
      {/* 筛选框在页签上方、两段共用；改筛选两段都回第 1 页。 */}
      <div className="mi-catalog__filters">
        <Input allowClear value={query} placeholder={text.filter} aria-label={text.filter}
          onChange={(event) => { setQuery(event.target.value); setMappedPage(1); setUnmappedPage(1) }} />
        {/* 分级筛选在「已映射」与「无需映射」出现——两段的行都有分级；未映射的 id 还没有分级，
            给它一个筛选器就是这个控件在撒谎。 */}
        {tab === 'unmapped' ? null : <Select<TierFilter> allowClear className="mi-catalog__filter-select"
          value={tierFilter === 'all' ? undefined : tierFilter} placeholder={text.tierFilter}
          aria-label={text.tierFilter} data-tier-filter
          options={TIER_OPTIONS.map((key) => ({ value: key, label: text.tiers[key] }))}
          onChange={(value) => { setTierFilter(value ?? 'all'); setMappedPage(1) }} />}
      </div>
      <div className="mi-catalog__table">{body}</div>
      {/* 分页条固定在弹框底部：表格区是唯一滚动容器，它不跟着行滚。 */}
      <div className="mi-catalog__footer">
        <Button size="small" className="mi-catalog__export" data-catalog-export
          disabled={view?.state !== 'available' || (counts.mapped === 0 && counts.unmapped === 0)}
          onClick={() => {
            // 导出的是**两张表的全量**，与界面上的筛选、页码、当前停在哪一页签都无关。
            const sheets = [
              // 空表也写：只留表头。整张表消失会被读成「没有这类数据」，一张只有表头的空表才是「这栏没有」。
              { name: text.sheetMapped, rows: mappedExportRows(fullMapped, { columns: text.columns, tiers: text.tiers }) },
              { name: text.sheetUnmapped, rows: unmappedExportRows(fullUnmapped, { columns: text.unmappedColumns }) }
            ]
            // 文件名固定：它不该反映一次筛选，否则同一天导两次会得到两个名字不同、内容也可能不同的文件。
            void window.platform?.app?.saveFile?.(exportFileName(text.title, new Date()), buildXlsx(sheets))
          }}>{text.exportLabel}</Button>
        {/* 筛选框里可能正输着词：必须有一句说清导出的是全部，否则会被当成「导错了」。 */}
        <span className="mi-catalog__footer-label" data-export-scope>{text.exportAllNote}</span>
        <Pager total={activeTotal} page={activePage} pageSize={pageSize}
          onPage={setActivePage}
          onSize={(size) => { setPageSize(size); setMappedPage(1); setUnmappedPage(1) }} />
      </div>
    </div>
  </Modal>
}

function paged<T>(rows: readonly T[], page: number, size: number): T[] {
  const start = (Math.max(1, page) - 1) * size
  return rows.slice(start, start + size)
}

function Pager({ total, page, pageSize, onPage, onSize }: Readonly<{
  total: number; page: number; pageSize: number; onPage: (page: number) => void; onSize: (size: number) => void
}>): React.ReactElement | null {
  if (total === 0) return null
  return <Pagination size="small" current={page} pageSize={pageSize} total={total} showSizeChanger
    pageSizeOptions={PAGE_SIZES.map((size) => String(size))}
    onChange={(next, size) => {
      // 之前只处理了 size，页码被吞掉——点页码没反应就是这个。
      if (size !== pageSize) onSize(size)
      else onPage(next)
    }} />
}
