import { useMemo, useState } from 'react'
import { Button, Input, Pagination, Table } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { helpTrigger } from '@platform/ui/components/popover'
import { StateView } from '@platform/ui/components/state'
import { Tabs } from '@platform/ui/components/tabs'
import type { ChoiceItem } from '@platform/ui/components/choice/choiceItem'

import type { UnmappedSourceIdRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type {
  CodeTableRead, CodeTableReadRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import { buildXlsx } from '@platform/files/export/xlsx'
import { MetricNameText } from '../../shared/MetricNameText'
import { codeTableExportRows, exportFileName, sampleText, unmappedExportRows } from './mappingRulesExport'

/**
 * 码表 / 未映射弹框（用户 2026-11-17：两个页签，**「已映射」整块拿掉**）。
 *
 * 为什么「已映射」要被换掉：那一页回答的是「哪条规则认得出哪个 id」，而读者要问的是
 * 「我们一共有哪些码、哪些根本没有源认得它」。码表一次给出 244 行（224 指标 + 20 事件），
 * 每行带分级 · 口径 · 官网页 · 状态 · 认得它的源内 id 数——**不再逐个列 id**。
 *
 * 三条边界：
 * - 官网页三态：有页是真的链接（`查看`）、待补是纯文字（`待核`，title 给理由）、不建/退役是 `—`；
 *   **绝不留空链接**（空链接会被读成「这个码没有官网页」）；
 * - 源 id 数为 **0 也显示 0**：那是「没有任何源认得它」，是这张表最有用的一格，留空就没信息了；
 * - 读不到是错误态，**不许画成空表**（空表会被读成「一个码都没有」）。
 */
export type MappingRulesText = Readonly<{
  title: string
  filter: string
  tabCodes: string
  tabUnmapped: string
  tabsAria: string
  unavailable: string
  codeColumns: Readonly<Record<'code' | 'country' | 'name' | 'tierMeasure' | 'official' | 'status' | 'sourceIds', string>>
  /** 没有国家时写什么（与日历同一句「未知国家」，不另造一个词）。 */
  unknownCountry: string
  codeStatus: Readonly<Record<'active' | 'not-built' | 'pending' | 'retired', string>>
  officialOpen: string
  officialPending: string
  officialNone: string
  codeEmpty: string
  unmappedColumns: Readonly<Record<'sourceId' | 'rows' | 'sample', string>>
  unmappedEmpty: string
  exportLabel: string
  /**
   * ⓘ 里的说明句**在这里解析**，不由调用方把整句传进来：说明句只允许出现在浮层入口，
   * 一路传字符串就等于让它在浮层之外再露一次脸。
   */
  resolveCopy: (key: string) => string
  sheetCodes: string
  sheetUnmapped: string
}>

const PAGE_SIZES = [20, 50, 100] as const
const has = (value: string | null | undefined): value is string => typeof value === 'string' && value !== ''

/** 码列**中段省略**，但末段留着——末段正是区分码的关键（`.YOY` 被切掉，两个码就分不出来）。 */
function shortCode(value: string): string {
  if (value.length <= 22) return value
  const tail = value.slice(-4)
  return `${value.slice(0, 13)}…${tail}`
}

export function MappingRulesDialog({ open, onClose, text, view, codes, onRetry }: Readonly<{
  open: boolean
  onClose: () => void
  text: MappingRulesText
  view: MappingRulesRead | undefined
  codes: CodeTableRead | undefined
  onRetry?: () => void
}>): React.ReactElement {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'codes' | 'unmapped'>('codes')
  const [codePage, setCodePage] = useState(1)
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const needle = query.trim().toLowerCase()
  const hit = (values: readonly (string | null | undefined)[]): boolean =>
    needle === '' || values.some((value) => has(value) && value.toLowerCase().includes(needle))

  const codeRows = useMemo(() => (codes?.state === 'available'
    ? codes.rows.filter((row) => hit([row.code, row.names.zhFull, row.names.enFull]))
    : []), [codes, needle])
  const unmappedRows = useMemo(() => (view?.state === 'available'
    ? view.unmapped.filter((row) => hit([row.sourceId, row.sampleLabel, row.sampleLabelEn]))
    : []), [view, needle])

  const codeCount = codes?.state === 'available' ? codes.counts.total : 0
  const unmappedCount = view?.state === 'available' ? view.counts.unmapped : 0
  const items: readonly ChoiceItem[] = [
    { value: 'codes', labelKey: 'tabCodes', labelParams: { count: String(codeCount) } },
    { value: 'unmapped', labelKey: 'tabUnmapped', labelParams: { count: String(unmappedCount) } }
  ]
  const copy: Readonly<Record<string, string>> = { tabCodes: text.tabCodes, tabUnmapped: text.tabUnmapped }

  const officialCell = (row: CodeTableReadRow): React.ReactElement | string => {
    // 决定不建、已经退役的码不放链接：那不是「待补」，是「不打算补」。
    if (row.status === 'not-built' || row.status === 'retired') return text.officialNone
    if ('pending' in row.officialSource) {
      // `待核` 是纯文字，理由放 title：**不渲染成链接**，否则读者会以为点得开。
      return <span data-official-pending title={row.officialSource.reason}>{text.officialPending}</span>
    }
    return <a href={row.officialSource.url} target="_blank" rel="noreferrer" data-official
      title={`${row.officialSource.agency} · ${row.officialSource.basis}`}
      className="mi-catalog__url">{text.officialOpen}</a>
  }

  const codesPanel = codeRows.length === 0
    ? <p className="mi-catalog__note">{text.codeEmpty}</p>
    : <Table<CodeTableReadRow> size="small" rowKey="code" pagination={false}
      dataSource={paged(codeRows, codePage, pageSize)}
      columns={[
        {
          title: text.codeColumns.code, dataIndex: 'code', width: 132, className: 'mi-catalog__cell-nowrap',
          render: (value: string) => <span title={value} data-code>{shortCode(value)}</span>
        },
        {
          // **国家在名称前面**（用户 2026-11-17）。名字由读口给（同一张国名表），渲染层不拼；
          // 读口给 null 就写「未知国家」——空着会被读成「这一行没有国家这一项」。
          title: text.codeColumns.country, width: 72, className: 'mi-catalog__cell-nowrap',
          render: (_value: unknown, row) => <span data-country>{row.countryName ?? text.unknownCountry}</span>
        },
        {
          title: text.codeColumns.name, dataIndex: 'names', width: 340,
          render: (value: CodeTableReadRow['names']) =>
            <span title={`${value.zhFull} · ${value.enFull}`} className="mi-catalog__code-name">
              <MetricNameText zh={value.zhFull} en={value.enFull} />
            </span>
        },
        {
          title: text.codeColumns.tierMeasure, width: 96,
          render: (_value: unknown, row) => <span className="mi-catalog__code-meta">
            <span data-tier>{row.tier === null ? '' : String(row.tier)}</span>
            <span data-measure>{[row.measure, row.seasonality].filter(has).join(' · ')}</span>
          </span>
        },
        {
          title: text.codeColumns.official, width: 92,
          render: (_value: unknown, row) => officialCell(row)
        },
        {
          title: text.codeColumns.status, dataIndex: 'status', width: 72, className: 'mi-catalog__cell-nowrap',
          render: (value: CodeTableReadRow['status']) =>
            <span data-code-status={value}>{text.codeStatus[value]}</span>
        },
        {
          title: text.codeColumns.sourceIds, dataIndex: 'sourceIdCount', width: 56,
          className: 'mi-catalog__cell-nowrap',
          // 0 就是 0：没有任何源认得它，这一格是这张表最有用的一处。
          render: (value: number) => String(value)
        }
      ]} />

  const unmappedPanel = unmappedRows.length === 0
    ? <p className="mi-catalog__note">{text.unmappedEmpty}</p>
    : <Table<UnmappedSourceIdRow> size="small" rowKey="sourceId" pagination={false}
      dataSource={paged(unmappedRows, unmappedPage, pageSize)}
      columns={[
        { title: text.unmappedColumns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.rows, dataIndex: 'rowCount', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.sample, dataIndex: 'sampleLabel',
          render: (_value: string | null, row) => sampleText(row) }
      ]} />

  const loading = view === undefined || codes === undefined
  const unreadable = view?.state !== 'available' || codes?.state !== 'available'
  const body = loading
    ? <StateView state="loading" />
    : unreadable
      ? <StateView state="error" reasonCode="unreadable"
        action={{ labelKey: 'ui.state.action.retry', onSelect: () => onRetry?.() }} />
      : <Tabs items={items} value={tab} onChange={(value) => {
        const next = value === 'unmapped' ? 'unmapped' : 'codes'
        setTab(next)
        // 切换页签回第 1 页：筛选词保留，页码各自独立，停在上一页签的页码会越界成空表。
        if (next === 'codes') setCodePage(1)
        else setUnmappedPage(1)
      }} ariaLabelKey="tabsAria" resolveText={(key) => copy[key] ?? key}
        panels={{
          codes: <section data-mapping-section="codes">{codesPanel}</section>,
          unmapped: <section data-mapping-section="unmapped">{unmappedPanel}</section>
        }} />

  const activeTotal = tab === 'codes' ? codeRows.length : unmappedRows.length
  const activePage = tab === 'codes' ? codePage : unmappedPage
  const setActivePage = (next: number): void => {
    if (tab === 'codes') setCodePage(next)
    else setUnmappedPage(next)
  }

  return <Modal open={open} width="maximum" titleKey="mappingRulesTitle"
    resolveText={(key) => key === 'mappingRulesTitle' ? text.title : key}
    onClose={onClose} className="mi-catalog-dialog">
    <div className="mi-catalog__body">
      <div className="mi-catalog__filters">
        <Input allowClear value={query} placeholder={text.filter} aria-label={text.filter}
          onChange={(event) => { setQuery(event.target.value); setCodePage(1); setUnmappedPage(1) }} />
      </div>
      <div className="mi-catalog__table">{body}</div>
      <div className="mi-catalog__footer">
        <Button size="small" className="mi-catalog__export" data-catalog-export
          disabled={view?.state !== 'available' || codes?.state !== 'available'
            || (codeCount === 0 && unmappedCount === 0)}
          onClick={() => {
            // 导出的是**两张表的全量**，与筛选、页码、当前页签无关。
            const sheets = [
              { name: text.sheetCodes, rows: codeTableExportRows(codes?.state === 'available' ? codes.rows : [], {
                columns: text.codeColumns, status: text.codeStatus, officialPending: text.officialPending,
                officialNone: text.officialNone, unknownCountry: text.unknownCountry
              }) },
              { name: text.sheetUnmapped, rows: unmappedExportRows(view?.state === 'available' ? view.unmapped : [],
                { columns: text.unmappedColumns }) }
            ]
            void window.platform?.app?.saveFile?.(exportFileName(text.title, new Date()), buildXlsx(sheets))
          }}>{text.exportLabel}</Button>
        {/* 「导出的是全部」这句**进 ⓘ**：正文只放结论，说明性长句一律收进浮层（界面规矩）。
            读者点按钮前仍看得到这颗图标，但不会让页脚多出一行说明。 */}
        <span className="mi-catalog__filters-help" data-export-scope>{helpTrigger({ text: text.resolveCopy('mappingExportAllNote') })}</span>
        <Pager total={activeTotal} page={activePage} pageSize={pageSize}
          onPage={setActivePage}
          onSize={(size) => { setPageSize(size); setCodePage(1); setUnmappedPage(1) }} />
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
      // 只处理 size 会把页码吞掉——点页码没反应就是这个。
      if (size !== pageSize) onSize(size)
      else onPage(next)
    }} />
}
