import { useMemo, useState } from 'react'
import { Input, Pagination, Table } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { StateView } from '@platform/ui/components/state'

import type {
  MappingRuleRow, MappingRulesRead, UnmappedSourceIdRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'

/**
 * 「映射规则」弹框：上面是**已映射**的规则（源内 id ↔ 我们的指标码），下面是库里**还没映射**的 id。
 *
 * 用户 2026-11-16：这里要看的是规则表，不是事件清单（事件清单日历里已经有了）。
 * 只读——补条目要先把规则从代码挪进库，那是另一件事。
 *
 * 三条口径：
 * - `counts` 由读口给，**前端不自己数**（筛选后标题上的数会和实际行数对不上）；
 * - `unmapped` 已按 `rowCount` 降序，前端不再排；
 * - `basis` / `officialUrl` 为 `null` 时**格子空着**，但**列一直在**——列忽有忽无比空着更迷惑，
 *   而且「官方查看」是用户点名要的；`null` 不写「无公开页」（那是逐条核过才敢写的话）。
 */
export type MappingRulesText = Readonly<{
  title: string
  filter: string
  mapped: string
  unmapped: string
  mappedEmpty: string
  unmappedEmpty: string
  unavailable: string
  columns: Readonly<{ sourceId: string; metricKey: string; periodRule: string; basis: string; official: string }>
  unmappedColumns: Readonly<{ sourceId: string; rows: string; sample: string }>
  official: string
}>

const PAGE_SIZES = [20, 50, 100] as const
const has = (value: string | null | undefined): value is string => typeof value === 'string' && value !== ''

export function MappingRulesDialog({ open, onClose, text, view, onRetry }: Readonly<{
  open: boolean
  onClose: () => void
  text: MappingRulesText
  view: MappingRulesRead | undefined
  onRetry?: () => void
}>): React.ReactElement {
  const [query, setQuery] = useState('')
  const [mappedPage, setMappedPage] = useState(1)
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const needle = query.trim().toLowerCase()
  const hit = (values: readonly (string | null | undefined)[]): boolean =>
    needle === '' || values.some((value) => has(value) && value.toLowerCase().includes(needle))
  const mapped = useMemo(() => (view?.state === 'available' ? view.mapped.filter((row) =>
    hit([row.sourceId, row.metricKey, row.basis, row.officialUrl])) : []), [view, needle])
  const unmapped = useMemo(() => (view?.state === 'available' ? view.unmapped.filter((row) =>
    hit([row.sourceId, row.sampleLabel])) : []), [view, needle])

  const body = view === undefined
    ? <StateView state="loading" />
    : view.state !== 'available'
      // 读不到是错误态：**不许**画成两张空表（那读者会以为「一条规则都没有」）。
      ? <StateView state="error" reasonCode="unreadable" action={{ labelKey: 'ui.state.action.retry', onSelect: () => onRetry?.() }} />
      : <>
        <section data-mapping-section="mapped">
          <h3 className="mi-catalog__section">{text.mapped.replace('{count}', String(view.counts.mapped))}</h3>
          {mapped.length === 0
            ? <p className="mi-catalog__note">{text.mappedEmpty}</p>
            : <Table<MappingRuleRow> size="small" rowKey="sourceId" pagination={false}
              dataSource={paged(mapped, mappedPage, pageSize)}
              columns={[
                { title: text.columns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
                { title: text.columns.metricKey, dataIndex: 'metricKey', className: 'mi-catalog__cell-nowrap' },
                { title: text.columns.periodRule, dataIndex: 'periodRule', className: 'mi-catalog__cell-nowrap' },
                // `basis` 现在一律 null：列在、格子空着。
                { title: text.columns.basis, dataIndex: 'basis', render: (value: string | null) => value ?? '' },
                {
                  title: text.columns.official, dataIndex: 'officialUrl',
                  render: (value: string | null) => has(value)
                    ? <a href={value} target="_blank" rel="noreferrer" data-official>{text.official}</a>
                    : null
                }
              ]} />}
          <Pager total={mapped.length} page={mappedPage} pageSize={pageSize}
            onPage={setMappedPage} onSize={(size) => { setPageSize(size); setMappedPage(1) }} />
        </section>
        <section data-mapping-section="unmapped">
          <h3 className="mi-catalog__section">{text.unmapped
            .replace('{count}', String(view.counts.unmapped))
            .replace('{rows}', String(view.counts.unmappedRows))}</h3>
          {unmapped.length === 0
            ? <p className="mi-catalog__note">{text.unmappedEmpty}</p>
            : <Table<UnmappedSourceIdRow> size="small" rowKey="sourceId" pagination={false}
              dataSource={paged(unmapped, unmappedPage, pageSize)}
              columns={[
                { title: text.unmappedColumns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
                { title: text.unmappedColumns.rows, dataIndex: 'rowCount', className: 'mi-catalog__cell-nowrap' },
                { title: text.unmappedColumns.sample, dataIndex: 'sampleLabel', render: (value: string | null) => value ?? '' }
              ]} />}
          <Pager total={unmapped.length} page={unmappedPage} pageSize={pageSize}
            onPage={setUnmappedPage} onSize={(size) => { setPageSize(size); setUnmappedPage(1) }} />
        </section>
      </>

  return <Modal open={open} width="maximum" titleKey="mappingRulesTitle"
    resolveText={(key) => key === 'mappingRulesTitle' ? text.title : key}
    onClose={onClose} className="mi-catalog-dialog">
    <div className="mi-catalog__body">
      <div className="mi-catalog__filters">
        <Input allowClear value={query} placeholder={text.filter} aria-label={text.filter}
          onChange={(event) => { setQuery(event.target.value); setMappedPage(1); setUnmappedPage(1) }} />
      </div>
      <div className="mi-catalog__table">{body}</div>
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
  return <div className="mi-catalog__pager">
    <Pagination size="small" current={page} pageSize={pageSize} total={total} showSizeChanger
      pageSizeOptions={PAGE_SIZES.map((size) => String(size))}
      onChange={(_next, size) => { onSize(size) }} />
  </div>
}
