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
import { filterMappedByTier, sortMappedRules, tierKeyOf, type TierFilter, type TierKey } from './mappingRulesView'

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
  tabMapped: string
  tabUnmapped: string
  tabsAria: string
  exportLabel: string
  exportEmpty: string
  /** 分级筛选器的占位（与「按国家筛选」同一种选择器）；选项复用 `tiers` 四档。 */
  tierFilter: string
  /** 导出文件里的两个工作表名。 */
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
  /**
   * 已映射：先按筛选词与分级筛，再按「行数降序 → 分级 → 指标码」摆。
   * 排序是**读者可见的顺序**，导出也用这一份——两边顺序一致，不会「屏幕上一个样、文件里另一个样」。
   */
  const mapped = useMemo(() => (view?.state === 'available'
    ? sortMappedRules(filterMappedByTier(view.mapped.filter((row) =>
      hit([row.sourceId, row.metricKey, row.basis, row.officialUrl, row.names?.zh, row.names?.en])), tierFilter))
    : []), [view, needle, tierFilter])
  const unmapped = useMemo(() => (view?.state === 'available' ? view.unmapped.filter((row) =>
    hit([row.sourceId, row.sampleLabel, row.sampleLabelEn])) : []), [view, needle])

  const counts = view?.state === 'available' ? view.counts : { mapped: 0, unmapped: 0, unmappedRows: 0 }
  const items: readonly ChoiceItem[] = [
    { value: 'mapped', labelKey: 'tabMapped', labelParams: { count: String(counts.mapped) } },
    { value: 'unmapped', labelKey: 'tabUnmapped', labelParams: { count: String(counts.unmapped) } }
  ]
  const copy: Readonly<Record<string, string>> = { tabMapped: text.tabMapped, tabUnmapped: text.tabUnmapped }

  const mappedPanel = mapped.length === 0
    ? <p className="mi-catalog__note">{text.mappedEmpty}</p>
    : <Table<MappingRuleRow> size="small" rowKey="sourceId" pagination={false}
      dataSource={paged(mapped, mappedPage, pageSize)}
      columns={[
        { title: text.columns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
        { title: text.columns.metricKey, dataIndex: 'metricKey', className: 'mi-catalog__cell-nowrap' },
        {
          // 中英放在同一格（`中文简称 · 英文全名`）；没有名表条目就空着，不拿指标码拼假英文名。
          title: text.columns.name, dataIndex: 'names',
          render: (value: MappingRuleRow['names']) => value === null ? '' : `${value.zh} · ${value.en}`
        },
        {
          // 分级直接读读口的 `tier`（分级表只有一处）；`null` 显示「未分级」，不空着。
          title: text.columns.tier, dataIndex: 'tier', className: 'mi-catalog__cell-nowrap',
          render: (value: 1 | 2 | 3 | null) => text.tiers[tierKeyOf(value)]
        },
        { title: text.columns.periodRule, dataIndex: 'periodRule', className: 'mi-catalog__cell-nowrap' },
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
      ]} />

  const unmappedPanel = unmapped.length === 0
    ? <p className="mi-catalog__note">{text.unmappedEmpty}</p>
    : <Table<UnmappedSourceIdRow> size="small" rowKey="sourceId" pagination={false}
      dataSource={paged(unmapped, unmappedPage, pageSize)}
      columns={[
        { title: text.unmappedColumns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.rows, dataIndex: 'rowCount', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.sample, dataIndex: 'sampleLabel', render: (_value: string | null, row) => sampleText(row) }
      ]} />

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
        panels={{ mapped: <section data-mapping-section="mapped">{mappedPanel}</section>,
          unmapped: <section data-mapping-section="unmapped">{unmappedPanel}</section> }} />

  const activeTotal = tab === 'mapped' ? mapped.length : unmapped.length

  return <Modal open={open} width="maximum" titleKey="mappingRulesTitle"
    resolveText={(key) => key === 'mappingRulesTitle' ? text.title : key}
    onClose={onClose} className="mi-catalog-dialog">
    <div className="mi-catalog__body">
      {/* 筛选框在页签上方、两段共用；改筛选两段都回第 1 页。 */}
      <div className="mi-catalog__filters">
        <Input allowClear value={query} placeholder={text.filter} aria-label={text.filter}
          onChange={(event) => { setQuery(event.target.value); setMappedPage(1); setUnmappedPage(1) }} />
        {/* 分级筛选只在「已映射」页签出现：未映射的 id 还没有分级，给它一个筛选器就是这个控件在撒谎。 */}
        {tab === 'mapped' ? <Select<TierFilter> allowClear className="mi-catalog__filter-select"
          value={tierFilter === 'all' ? undefined : tierFilter} placeholder={text.tierFilter}
          aria-label={text.tierFilter} data-tier-filter
          options={TIER_OPTIONS.map((key) => ({ value: key, label: text.tiers[key] }))}
          onChange={(value) => { setTierFilter(value ?? 'all'); setMappedPage(1) }} /> : null}
      </div>
      <div className="mi-catalog__table">{body}</div>
      {/* 分页条固定在弹框底部：表格区是唯一滚动容器，它不跟着行滚。 */}
      <div className="mi-catalog__footer">
        <Button size="small" className="mi-catalog__export" data-catalog-export
          disabled={view?.state !== 'available' || (mapped.length === 0 && unmapped.length === 0)}
          onClick={() => {
            // 导出的是**两张表各自筛选结果的全量**，不是当前页、也不看停在哪一页签：
            // 读者点「导出」要的是一份能拿去核对的完整文件，不是「我眼前这一屏」。
            const sheets = [
              // 空表也写：只留表头。整张表消失会被读成「没有这类数据」，一张只有表头的空表才是「这栏没有」。
              { name: text.sheetMapped, rows: mappedExportRows(mapped, { columns: text.columns, tiers: text.tiers }) },
              { name: text.sheetUnmapped, rows: unmappedExportRows(unmapped, { columns: text.unmappedColumns }) }
            ]
            void window.platform?.app?.saveFile?.(exportFileName(text.title, new Date()), buildXlsx(sheets))
          }}>{text.exportLabel}</Button>
        <Pager total={activeTotal} page={tab === 'mapped' ? mappedPage : unmappedPage} pageSize={pageSize}
          onPage={(next) => { if (tab === 'mapped') setMappedPage(next); else setUnmappedPage(next) }}
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
