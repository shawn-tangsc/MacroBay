import { useMemo, useState } from 'react'
import { Button, Input, Pagination, Select, Table } from 'antd'

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
  codeColumns: Readonly<Record<'code' | 'country' | 'name' | 'tier' | 'measure' | 'official' | 'status' | 'sourceIds' | 'dataVolume', string>>
  /** 国家筛选的两个词：「全部国家」与那颗下拉的读屏名。 */
  countryAll: string
  countryFilter: string
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

/**
 * 码表九列的宽度，**只在这里定义一次**。
 *
 * 为什么收成常量：一屏能不能同时看到九列，是这九个数的和加上单元格内距，与弹框可用宽度之比。
 * 弹框 `full` 档是 1280，但 antd 的 `max-width: calc(100vw - 32px)` 会先扣掉 32——**窗口 1280 时
 * 真实可用只有 1248**（要真吃到 1280 得窗口 ≥1312）。上一版验收按「窗口 ≥1280 不横滚」写，
 * 其实测的是 1248；这里按 1248 重新配过一次，并把预算写成用例（改宽了会红）：
 * 960（九列）+ 144（9 格 × 左右各 8）＝ 1104 ≤ 1248 − 48（弹框内距）− 16（纵向滚动条）＝ 1184。
 */
export const CODE_TABLE_COLUMN_WIDTHS = {
  code: 124, country: 72, name: 300, tier: 60, measure: 100,
  official: 92, status: 72, sourceIds: 56, dataVolume: 84
} as const

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
  /** 国家筛选：`''` = 全部国家（默认）。选项从**同一份码表数据**派生，不另查一次。 */
  const [country, setCountry] = useState('')
  const [tab, setTab] = useState<'codes' | 'unmapped'>('codes')
  const [codePage, setCodePage] = useState(1)
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const needle = query.trim().toLowerCase()
  const hit = (values: readonly (string | null | undefined)[]): boolean =>
    needle === '' || values.some((value) => has(value) && value.toLowerCase().includes(needle))

  const countryOptions = useMemo(() => {
    if (codes?.state !== 'available') return [] as { value: string; label: string }[]
    const seen = new Set<string>()
    for (const row of codes.rows) seen.add(row.countryName ?? text.unknownCountry)
    return [{ value: '', label: text.countryAll },
      ...[...seen].sort((left, right) => left.localeCompare(right)).map((name) => ({ value: name, label: name }))]
  }, [codes, text.countryAll, text.unknownCountry])
  const codeRows = useMemo(() => (codes?.state === 'available'
    ? codes.rows.filter((row) => hit([row.code, row.names.zhFull, row.names.enFull]))
      .filter((row) => country === '' || (row.countryName ?? text.unknownCountry) === country)
    : []), [codes, needle, country, text.unknownCountry])
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
          title: text.codeColumns.code, dataIndex: 'code', width: CODE_TABLE_COLUMN_WIDTHS.code, className: 'mi-catalog__cell-nowrap',
          render: (value: string) => <span title={value} data-code>{shortCode(value)}</span>
        },
        {
          // **国家在名称前面**（用户 2026-11-17）。名字由读口给（同一张国名表），渲染层不拼；
          // 读口给 null 就写「未知国家」——空着会被读成「这一行没有国家这一项」。
          title: text.codeColumns.country, width: CODE_TABLE_COLUMN_WIDTHS.country, className: 'mi-catalog__cell-nowrap',
          render: (_value: unknown, row) => <span data-country>{row.countryName ?? text.unknownCountry}</span>
        },
        {
          title: text.codeColumns.name, dataIndex: 'names', width: CODE_TABLE_COLUMN_WIDTHS.name,
          render: (value: CodeTableReadRow['names']) =>
            <span title={`${value.zhFull} · ${value.enFull}`} className="mi-catalog__code-name">
              <MetricNameText zh={value.zhFull} en={value.enFull} />
            </span>
        },
        {
          // 分级与口径**分开两列**（用户 2026-11-17）：一格两件事，读者分不清哪个是级别。
          title: text.codeColumns.tier, width: CODE_TABLE_COLUMN_WIDTHS.tier, className: 'mi-catalog__cell-nowrap',
          render: (_value: unknown, row) => <span data-tier>{row.tier === null ? '' : String(row.tier)}</span>
        },
        {
          title: text.codeColumns.measure, width: CODE_TABLE_COLUMN_WIDTHS.measure,
          render: (_value: unknown, row) => <span data-measure>{[row.measure, row.seasonality].filter(has).join(' · ')}</span>
        },
        {
          title: text.codeColumns.official, width: CODE_TABLE_COLUMN_WIDTHS.official,
          render: (_value: unknown, row) => officialCell(row)
        },
        {
          title: text.codeColumns.status, dataIndex: 'status', width: CODE_TABLE_COLUMN_WIDTHS.status, className: 'mi-catalog__cell-nowrap',
          render: (value: CodeTableReadRow['status']) =>
            <span data-code-status={value}>{text.codeStatus[value]}</span>
        },
        {
          title: text.codeColumns.sourceIds, dataIndex: 'sourceIdCount', width: CODE_TABLE_COLUMN_WIDTHS.sourceIds,
          className: 'mi-catalog__cell-nowrap',
          // 0 就是 0：没有任何源认得它，这一格是这张表最有用的一处。
          render: (value: number) => String(value)
        },
        {
          // 数据量紧挨「源 id 数」，两个标签各写各的：一个是「有多少发布行」，一个是「认得几个源内 id」。
          // 默认顺序不动（仍按码）；**列头可点排序**，点一下就能把 0 的码排到眼前。
          title: text.codeColumns.dataVolume, dataIndex: 'releaseRowCount', width: CODE_TABLE_COLUMN_WIDTHS.dataVolume,
          className: 'mi-catalog__cell-nowrap',
          sorter: (left: CodeTableReadRow, right: CodeTableReadRow) => left.releaseRowCount - right.releaseRowCount,
          render: (value: number) => <span data-data-volume>{String(value)}</span>
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

  return <Modal open={open} width="full" titleKey="mappingRulesTitle"
    resolveText={(key) => key === 'mappingRulesTitle' ? text.title : key}
    onClose={onClose} className="mi-catalog-dialog">
    <div className="mi-catalog__body">
      <div className="mi-catalog__filters">
        <Input allowClear value={query} placeholder={text.filter} aria-label={text.filter}
          onChange={(event) => { setQuery(event.target.value); setCodePage(1); setUnmappedPage(1) }} />
        {/* 国家筛选取同一份码表数据；「全部国家」是默认，切回它不该还要再点一次清除。 */}
        <Select size="small" value={country} aria-label={text.countryFilter} options={[...countryOptions]}
          onChange={(value) => { setCountry(value); setCodePage(1) }} data-country-filter />
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
