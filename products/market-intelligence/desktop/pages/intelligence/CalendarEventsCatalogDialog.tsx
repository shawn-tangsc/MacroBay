import { useMemo, useState } from 'react'
import { Input, Pagination, Table } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'

import {
  EMPTY_CATALOG_FILTERS, filterCatalogRows, pageOf, sortCatalogRows,
  type CatalogFilters, type CatalogRow
} from './calendarEventCatalogModel'

/**
 * 日历头部那个按钮打开的「事件目录」弹框：一张带筛选与分页的表格。
 *
 * 范围说明写在标题里（`scopeLabel`）：现在只有按月读口，所以标题如实写「本月」——
 * **全量读口到位之前不许叫「全量事件表」**，那是一个还没上线的承诺。
 *
 * 四态互不冒充（Chief 2026-11-16 定的判据）：
 * - 读不到 → `StateView` 的错误态，**不许画成空表**；
 * - 读到但筛选后 0 行 → 空态，句子说「没有匹配」而不是「没有数据」；
 * - 加载中 → 加载态；
 * - 有行 → 表格。
 */
export type CatalogState = 'loading' | 'ready' | 'unavailable'

export type CatalogText = Readonly<{
  title: string
  nameFilter: string
  countryFilter: string
  importanceFilter: string
  importanceAny: string
  columns: Readonly<{ name: string; country: string; period: string; date: string; next: string; time: string; importance: string }>
  sourceLabelTag: string
  loading: string
  unavailable: string
  noMatch: string
  pageSizeLabel: string
  importance: Readonly<Record<'high' | 'medium' | 'low', string>>
}>

const PAGE_SIZES = [50, 100, 200] as const

export type CatalogColumn = 'name' | 'country' | 'period' | 'date' | 'next' | 'time' | 'importance'

export function CalendarEventsCatalogDialog({ open, onClose, text, rows, state, columns, onRetry }: Readonly<{
  open: boolean
  onClose: () => void
  text: CatalogText
  /** 这一份的范围由调用方决定（现在是一个月）；本组件不做读取。 */
  rows: readonly CatalogRow[]
  state: CatalogState
  /**
   * 画哪几列。**由调用方按「手上真有的数据」给**：范围还是「本月」时只有名称/国家/时刻，
   * 硬画日期或重要性会得到两列空白——空列会被读成「这些事件没有这个字段」。
   * 全量读口到位后传全量六列。
   */
  columns: readonly CatalogColumn[]
  /** 读不到时那个「重试」要真的重读；不给就只是关掉重开（调用方负责接上）。 */
  onRetry?: () => void
}>): React.ReactElement {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_CATALOG_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const filtered = useMemo(() => sortCatalogRows(filterCatalogRows(rows, filters)), [rows, filters])
  const pageOfRows = pageOf(filtered, page, pageSize)

  const body = state === 'loading'
    ? <StateView state="loading" />
    : state === 'unavailable'
      // 读不到是错误态：**不许**用空表表示，那读者会以为「一个事件都没有」。
      // 「读不到」必须带一个动作：只报状态不给下一步，读者只能关掉弹框重来。
      ? <StateView state="error" reasonCode="unreadable"
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => onRetry?.() }} />
      : filtered.length === 0
        // 筛选后为 0 行：,动作是「清除筛选」——它是读者唯一能做的事，也是正确的那件事。
        ? <StateView state="empty" reasonCode="filtered-out"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.clear_filter, onSelect: () => { setFilters(EMPTY_CATALOG_FILTERS); setPage(1) } }} />
        : <Table<CatalogRow>
          size="small"
          rowKey="key"
          dataSource={[...pageOfRows.rows]}
          pagination={false}
          columns={columns.map((column) => {
            if (column === 'name') return { title: text.columns.name, dataIndex: 'title', render: (_value: unknown, row: CatalogRow) => <span data-catalog-name>{row.title}{row.titleIsSourceLabel ? <em className="mi-catalog__tag">{text.sourceLabelTag}</em> : null}</span> }
            if (column === 'country') return { title: text.columns.country, dataIndex: 'countryLabel' }
            if (column === 'period') return { title: text.columns.period, dataIndex: 'period', render: (value: string | undefined) => value ?? '' }
            if (column === 'next') return { title: text.columns.next, dataIndex: 'nextRelease', render: (value: string | undefined) => value ?? '' }
            if (column === 'date') return { title: text.columns.date, dataIndex: 'lastRelease', render: (value: string | undefined) => value ?? '' }
            if (column === 'time') return { title: text.columns.time, dataIndex: 'time', render: (value: string | undefined) => value ?? '' }
            return { title: text.columns.importance, dataIndex: 'importance', render: (value: CatalogRow['importance']) => value === undefined ? '' : text.importance[value] }
          })} />

  return <Modal
    open={open}
    width="expanded"
    titleKey="calendarCatalogTitle"
    resolveText={(key) => key === 'calendarCatalogTitle' ? text.title : key}
    onClose={onClose}
    className="mi-catalog-dialog">
    <div className="mi-catalog__filters">
      <Input allowClear value={filters.name} placeholder={text.nameFilter} aria-label={text.nameFilter}
        onChange={(event) => { setFilters({ ...filters, name: event.target.value }); setPage(1) }} />
      <Input allowClear value={filters.country} placeholder={text.countryFilter} aria-label={text.countryFilter}
        onChange={(event) => { setFilters({ ...filters, country: event.target.value }); setPage(1) }} />
      <Input allowClear value={filters.importance} placeholder={text.importanceFilter} aria-label={text.importanceFilter}
        onChange={(event) => { setFilters({ ...filters, importance: event.target.value }); setPage(1) }} />
    </div>
    {body}
    {state === 'ready' && filtered.length > 0
      ? <div className="mi-catalog__pager">
        <Pagination
          size="small" current={pageOfRows.page} pageSize={pageSize} total={filtered.length}
          showSizeChanger pageSizeOptions={PAGE_SIZES.map((size) => String(size))}
          onChange={(nextPage, nextSize) => { setPageSize(nextSize); setPage(1) }} />
      </div>
      : null}
  </Modal>
}
