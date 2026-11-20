import { useMemo, useState } from 'react'
import { Button, Checkbox, Input, Pagination, Select, Table } from 'antd'

import { Modal } from '@platform/ui/components/modal'
import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'
import { helpTrigger } from '@platform/ui/components/popover'
import { StateView } from '@platform/ui/components/state'
import { Tabs } from '@platform/ui/components/tabs'
import type { ChoiceItem } from '@platform/ui/components/choice/choiceItem'

import type { UnmappedSourceIdRow } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type {
  CodeTableRead, CodeTableReadRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import type {
  CalendarEventListRead, CalendarEventRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { formatShellDay } from '@platform/ui/time/shellTimeFormat'
import { buildXlsx } from '@platform/files/export/xlsx'
import { MetricNameText } from '../../shared/MetricNameText'
import { codeTableExportRows, eventExportRows, exportFileName, sampleText, unmappedExportRows } from './mappingRulesExport'
import { countryOptionsFrom, filterCodeRows, has, filterEventRows, filterUnmappedRows, officialOptionsFrom, reasonOptionsFrom, tierOptionsFrom } from './mappingRulesFilters'
import { eventTimeCell, officialCell, shortCode } from './mappingRulesCells'

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

  /** 旧单选时代的两条文案，现在多选不再需要「全部」选项。 */
  countryFilter: string
  /**
   * 事件类型码的国家说明（列头 ⓘ）：它们不是「国家未知」，而是「这一类没有单一主办国」，
   * 国家由具体那场事件提供。所以国家列对这些行显示 `—`，不写「未知国家」。
   */
  countryNote: string
  codeStatus: Readonly<Record<'active' | 'not-built' | 'pending' | 'retired', string>>
  officialOpen: string
  officialPending: string
  officialNone: string
  codeEmpty: string
  unmappedColumns: Readonly<Record<'sourceId' | 'country' | 'rows' | 'sample' | 'firstSeen' | 'providers' | 'reason', string>>
  /** 原因七档的白话文案（键与读口闭集同名）。 */
  unmappedReasons: Readonly<Record<string, string>>
  reasonFilter: string
  reasonAll: string
  tierStars: Readonly<Record<'1' | '2' | '3' | 'other', string>>
  tierAria: Readonly<Record<'1' | '2' | '3' | 'other', string>>
  tierFilterMulti: string
  countryFilterMulti: string
  /**
   * **官网页筛选**（用户 2026-11-19）：三档与那一列同义——已核（有机构页）/ 待核（还没核到）/
   * `—`（不建或退役，没有页）。多选，选项只列当前表里真实出现过的档。
   */
  officialFilterMulti: string
  officialStates: Readonly<Record<'checked' | 'pending' | 'none', string>>
  unmappedEmpty: string
  /** 「只看有数据的」：860 个码里只有约 570 个真落过行，打开时第一眼该看到有内容的。 */
  onlyWithData: string
  exportLabel: string
  /**
   * ⓘ 里的说明句**在这里解析**，不由调用方把整句传进来：说明句只允许出现在浮层入口，
   * 一路传字符串就等于让它在浮层之外再露一次脸。
   */
  resolveCopy: (key: string) => string
  sheetCodes: string
  sheetUnmapped: string
  /**
   * **第三个页签：事件**（用户 2026-11-18）。经济事件与央行活动**不参与映射**：它们没有统计期，
   * 也不该出现在「未映射」里——那张表是「该归到码上的数据」。
   */
  tabEvents: string
  eventColumns: Readonly<Record<'time' | 'country' | 'title' | 'provider' | 'status', string>>
  eventsEmpty: string
  /** 源没给标题时那一格写什么：不编一个名字，也不留空。 */
  eventTitleMissing: string
  sheetEvents: string
  /** 分级的中文名（导出里与星级同一格）。 */
  tierNames: Readonly<Record<'1' | '2' | '3' | 'other', string>>
  /** 导出比界面多两列：中英名拆开。 */
  exportNameZh: string
  exportNameEn: string
  /** 状态闭集之外的值：显示「无法确认」，不印枚举、也不留空。 */
  statusUnknown: string
  /**
   * 发布状态的白话名（与日历行**同一份**文案表，由调用方传入）：两处各写一份，迟早给出两个说法。
   */
  eventStatus: Readonly<Record<string, string>>
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

export function MappingRulesDialog({ open, onClose, text, view, codes, events, onRetry }: Readonly<{
  open: boolean
  onClose: () => void
  text: MappingRulesText
  view: MappingRulesRead | undefined
  codes: CodeTableRead | undefined
  events: CalendarEventListRead | undefined
  onRetry?: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  // 名称列按**界面语言**取主名（用户 2026-11-20）：英文界面只显示英文，缺英文才回退中文。
  // 用平台既有的语言上下文，不新造一个；语言变了组件本来就整体重渲染。
  const locale = useShellLanguage()
  const [query, setQuery] = useState('')
  const [onlyWithData, setOnlyWithData] = useState(false)
  /** 原因筛选：`''` = 全部。选项只列**当前这批行里真实出现过的原因**，不铺满七档。 */
  const [reason, setReason] = useState('')
  /** 国家筛选（**多选**）：空数组 = 全部。选项从同一份码表数据派生，不另查一次。 */
  const [countries, setCountries] = useState<readonly string[]>([])
  /** 分级筛选（**多选**）：空数组 = 全部。档位键 `1|2|3|other`。 */
  const [tiers, setTiers] = useState<readonly string[]>([])
  /** 官网页筛选（**多选**）：空数组 = 全部。档位键 `checked|pending|none`。 */
  const [officials, setOfficials] = useState<readonly string[]>([])
  const [tab, setTab] = useState<'codes' | 'unmapped' | 'events'>('codes')
  const [codePage, setCodePage] = useState(1)
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [eventPage, setEventPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const needle = query.trim().toLowerCase()
  const countryOptions = useMemo(() => countryOptionsFrom(codes?.state === 'available' ? codes.rows : []), [codes])
  // 事件页签的国家选项从事件那一页派生，不混进码表的国家名单（混了会筛出空结果）。
  const eventCountryOptions = useMemo(() => countryOptionsFrom(events?.state === 'available' ? events.rows : []), [events])
  const officialOptions = useMemo(() => officialOptionsFrom(codes, text.officialStates), [codes, text.officialStates])
  const tierOptions = useMemo(() => tierOptionsFrom(codes, text.tierStars, text.tierNames), [codes, text.tierStars, text.tierNames])
  const codeRows = useMemo(() => filterCodeRows(codes, { needle, countries, tiers, officials, onlyWithData }),
    [codes, needle, countries, tiers, officials, onlyWithData])
  const unmappedRows = useMemo(() => filterUnmappedRows(view, { needle, reason }), [view, needle, reason])
  const eventRows = useMemo(() => filterEventRows(events, { needle, countries }), [events, needle, countries])
  const reasonOptions = useMemo(() => reasonOptionsFrom(view, text.reasonAll, text.unmappedReasons),
    [view, text.reasonAll, text.unmappedReasons])

  const codeCount = codes?.state === 'available' ? codes.counts.total : 0
  const unmappedCount = view?.state === 'available' ? view.counts.unmapped : 0
  const eventCount = events?.state === 'available' ? events.total : 0
  // 标签传的是**键**（`mkDay.…` 是这张文案表里的真实路径），句子由下面的解析器取；
  // 裸词（`tabCodes`）不是键，`choiceKeyGuard` 会红——那正是它要挡的「把已解析句子当键传」。
  const items: readonly ChoiceItem[] = [
    { value: 'codes', labelKey: 'mkDay.mappingTabCodes', labelParams: { count: String(codeCount) } },
    { value: 'unmapped', labelKey: 'mkDay.mappingTabUnmapped', labelParams: { count: String(unmappedCount) } },
    { value: 'events', labelKey: 'mkDay.mappingTabEvents', labelParams: { count: String(eventCount) } }
  ]
  /**
   * 键 → 文案。键写的是它在**抽屉那张文案表**里的路径（`mkDay.mappingTabCodes`），这里映射到本弹框
   * 的字段名——两边名字不同是既有的：弹框的契约收的是值（`tabCodes`），文案表收的是路径。
   */
  const copy: Readonly<Record<string, string>> = {
    'mkDay.mappingTabCodes': text.tabCodes,
    'mkDay.mappingTabUnmapped': text.tabUnmapped,
    'mkDay.mappingTabEvents': text.tabEvents
  }
  const resolveCopyText = (key: string): string => copy[key] ?? key

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
          // **国家在名称前面**（用户 2026-11-17）。名字由读口给（同一张国名表），渲染层不拼。
          // 事件类型码**没有单一主办国**（`evt.central-bank-speech` 不是「美国讲话」），
          // 国家列写 `—`，并在列头 ⓘ 说明——不写「未知国家」，那会让人以为我们连国家都没拿到。
          title: <span className="mi-catalog__head-with-help">{text.codeColumns.country}
            {helpTrigger({ text: text.countryNote })}</span>,
          width: CODE_TABLE_COLUMN_WIDTHS.country, className: 'mi-catalog__cell-nowrap',
          render: (_value: unknown, row) => row.countryName === null
            ? <span data-country-empty>—</span>
            : <span data-country>{row.countryName}</span>
        },
        {
          title: text.codeColumns.name, dataIndex: 'names', width: CODE_TABLE_COLUMN_WIDTHS.name,
          render: (value: CodeTableReadRow['names']) =>
            <span title={`${value.zhFull} · ${value.enFull}`} className="mi-catalog__code-name">
              <MetricNameText zh={value.zhFull} en={value.enFull} locale={locale} />
            </span>
        },
        {
          // 分级与口径**分开两列**（用户 2026-11-17）：一格两件事，读者分不清哪个是级别。
          title: text.codeColumns.tier, width: CODE_TABLE_COLUMN_WIDTHS.tier, className: 'mi-catalog__cell-nowrap',
          // 分级用**星级**（一级★★★ / 二级★★ / 三级★ / 未分级 —），读屏名写全，不只念符号。
          render: (_value: unknown, row) => {
            const key = row.tier === null ? 'other' : String(row.tier) as '1' | '2' | '3'
            return <span data-tier={key} aria-label={text.tierAria[key]} className="mi-catalog__tier-stars">
              {text.tierStars[key]}
            </span>
          }
        },
        {
          title: text.codeColumns.measure, width: CODE_TABLE_COLUMN_WIDTHS.measure,
          render: (_value: unknown, row) => <span data-measure>{[row.measure, row.seasonality].filter(has).join(' · ')}</span>
        },
        {
          title: text.codeColumns.official, width: CODE_TABLE_COLUMN_WIDTHS.official,
          render: (_value: unknown, row) => officialCell(row, text)
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

  const unmappedPanel = <>
    {unmappedRows.length === 0
      ? <p className="mi-catalog__note">{text.unmappedEmpty}</p>
    : <Table<UnmappedSourceIdRow> size="small" rowKey="sourceId" pagination={false}
      dataSource={paged(unmappedRows, unmappedPage, pageSize)}
      columns={[
        { title: text.unmappedColumns.sourceId, dataIndex: 'sourceId', className: 'mi-catalog__cell-nowrap' },
        {
          /* 国家在「源内 id」之后、「样本名字」之前（用户 2026-11-19）：先看是哪国的事，再看叫什么。
             取不到就 `—`：**不写「未知国家」**——那是上一版被否掉的写法，会把「没有」说成「不知道」。 */
          title: text.unmappedColumns.country, dataIndex: 'countryName', className: 'mi-catalog__cell-nowrap',
          render: (value: string | null | undefined) => value === null || value === undefined
            ? <span data-unmapped-country-empty>—</span>
            : <span data-unmapped-country>{value}</span>
        },
        { title: text.unmappedColumns.rows, dataIndex: 'rowCount', className: 'mi-catalog__cell-nowrap' },
        { title: text.unmappedColumns.sample, dataIndex: 'sampleLabel',
          render: (_value: string | null, row) => sampleText(row) },
        // **首次出现 + 来源**：判断「这是新东西，还是老东西又冒出来」靠这两列；
        // 时间走平台格式化（读者时区），不在这里手拼。
        { title: text.unmappedColumns.firstSeen, dataIndex: 'firstSeenAt', className: 'mi-catalog__cell-nowrap',
          render: (value: string | null) => value === null ? '' : formatTime(value, 'second') },
        { title: text.unmappedColumns.providers, dataIndex: 'providerIds', className: 'mi-catalog__cell-nowrap',
          render: (value: readonly string[]) => value.join(' · ') },
        {
          // **原因写成白话**（`no-code` → 「没有对应的码」）：内部枚举不给读者看。
          title: text.unmappedColumns.reason, dataIndex: 'reason', className: 'mi-catalog__cell-nowrap',
          render: (value: string) => <span data-unmapped-reason={value}>{text.unmappedReasons[value] ?? value}</span>
        }
      ]} />}
  </>

  /**
   * **事件页签**：一行 = 一场事件，时间 · 国家 · 标题 · 来源 · 状态，只读。
   *
   * 三处口径写在这里：
   * - **没有期次列**：事件没有统计期，缺期次不是缺陷——这一页不出现那个概念；
   * - **日期精度的事件不显示时刻**：日期按 `UTC` 格式化成那个日历日（日期是日期，不是瞬时；
   *   按读者时区换算会把 10-14 变成 10-13），有时刻的才按读者时区显示到分钟；
   * - **状态**取日历行同一份白话表；表里没有的写「无法确认」，不印枚举、也不留空。
   */
  const eventsPanel = events?.state !== 'available'
    // 读不到就给重试（与其他两个页签同一态）：事件页读失败不能被画成「库里没有事件」。
    ? <StateView state="error" reasonCode="unreadable"
      action={{ labelKey: 'ui.state.action.retry', onSelect: () => onRetry?.() }} />
    : eventRows.length === 0
      ? <p className="mi-catalog__note">{text.eventsEmpty}</p>
      : <Table<CalendarEventRow> size="small" rowKey="key" pagination={false}
        dataSource={paged(eventRows, eventPage, pageSize)}
        columns={[
          {
            title: text.eventColumns.time, dataIndex: 'scheduledDate', className: 'mi-catalog__cell-nowrap',
            render: (_value: string, row) => <span data-event-time>{eventTimeCell(row, formatTime)}</span>
          },
          {
            title: text.eventColumns.country, className: 'mi-catalog__cell-nowrap',
            render: (_value: unknown, row) => row.countryName === null
              ? <span data-country-empty>—</span>
              : <span data-country>{row.countryName}</span>
          },
          {
            // 标题=源给的原文名：中文主行 + 英文次行（与码表名称同一套渲染，没有英文就只一行）。
            title: text.eventColumns.title,
            render: (_value: unknown, row) => row.title === null
              ? <span data-event-title-missing>{text.eventTitleMissing}</span>
              : <span className="mi-catalog__code-name" title={row.titleEn === null ? row.title : `${row.title} · ${row.titleEn}`}>
                <MetricNameText zh={row.title} en={row.titleEn ?? ''} locale={locale} />
              </span>
          },
          {
            title: text.eventColumns.provider, dataIndex: 'sourceProviderId', className: 'mi-catalog__cell-nowrap'
          },
          {
            title: text.eventColumns.status, dataIndex: 'status', className: 'mi-catalog__cell-nowrap',
            render: (value: string | null) => <span data-event-status={value ?? 'unknown'}>
              {value === null ? text.statusUnknown : (text.eventStatus[value] ?? text.statusUnknown)}
            </span>
          }
        ]} />

  const loading = view === undefined || codes === undefined
  const unreadable = view?.state !== 'available' || codes?.state !== 'available'
  const body = loading
    ? <StateView state="loading" />
    : unreadable
      ? <StateView state="error" reasonCode="unreadable"
        action={{ labelKey: 'ui.state.action.retry', onSelect: () => onRetry?.() }} />
      : <Tabs items={items} value={tab} onChange={(value) => {
        const next = value === 'unmapped' ? 'unmapped' : value === 'events' ? 'events' : 'codes'
        setTab(next)
        // 切换页签回第 1 页：筛选词保留，页码各自独立，停在上一页签的页码会越界成空表。
        if (next === 'codes') setCodePage(1)
        else if (next === 'unmapped') setUnmappedPage(1)
        else setEventPage(1)
      }} ariaLabelKey="tabsAria" resolveText={resolveCopyText}
        panels={{
          codes: <section data-mapping-section="codes">{codesPanel}</section>,
          unmapped: <section data-mapping-section="unmapped">{unmappedPanel}</section>,
          events: <section data-mapping-section="events">{eventsPanel}</section>
        }} />

  const activeTotal = tab === 'codes' ? codeRows.length : tab === 'unmapped' ? unmappedRows.length : eventRows.length
  const activePage = tab === 'codes' ? codePage : tab === 'unmapped' ? unmappedPage : eventPage
  const setActivePage = (next: number): void => {
    if (tab === 'codes') setCodePage(next)
    else if (tab === 'unmapped') setUnmappedPage(next)
    else setEventPage(next)
  }

  return <Modal open={open} width="full" titleKey="mappingRulesTitle"
    resolveText={(key) => key === 'mappingRulesTitle' ? text.title : key}
    onClose={onClose} className="mi-catalog-dialog">
    <div className="mi-catalog__body">
      <div className="mi-catalog__filters">
        <Input allowClear value={query} placeholder={text.filter} aria-label={text.filter}
          onChange={(event) => { setQuery(event.target.value); setCodePage(1); setUnmappedPage(1) }} />
        {/* 只在未映射页签有意义：那一页本来就是「没落的指标」，按原因收窄就是为了挑出「没有对应的码」那批。 */}
        {tab === 'unmapped'
          ? <Select<string> allowClear className="mi-catalog__filter-select" value={reason === '' ? undefined : reason}
            placeholder={text.reasonFilter} aria-label={text.reasonFilter} data-reason-filter
            options={reasonOptions}
            onChange={(value) => { setReason(value ?? ''); setUnmappedPage(1) }} />
          : null}
        {/* 「只看有数据的」只对码表有意义：事件没有数据量这个概念。 */}
        {tab === 'codes' ? <span className="mi-catalog__only-data" data-only-with-data>
          <Checkbox checked={onlyWithData}
            onChange={(event) => { setOnlyWithData(event.target.checked); setCodePage(1) }}>
            {text.onlyWithData}
          </Checkbox>
        </span> : null}
        {/* **两个筛选都多选**（用户 2026-11-18）：同一筛选内是「或」，两者之间是「且」。
            清空（点 ×）就是全部，不需要一个「全部」选项占一格。
            事件页签**只留国家**：它没有分级，选项也改成从事件行派生（混用码表名单会筛出空结果）。 */}
        {tab === 'unmapped' ? null : <Select mode="multiple" allowClear size="small" className="mi-catalog__filter-select"
          value={[...countries]} aria-label={text.countryFilterMulti} placeholder={text.countryFilterMulti}
          options={tab === 'events' ? [...eventCountryOptions] : [...countryOptions]}
          onChange={(value) => { setCountries(value); setCodePage(1); setEventPage(1) }}
          data-country-filter maxTagCount="responsive" />}
        {tab === 'codes' ? <Select mode="multiple" allowClear size="small" className="mi-catalog__filter-select"
          value={[...tiers]} aria-label={text.tierFilterMulti} placeholder={text.tierFilterMulti}
          options={tierOptions} onChange={(value) => { setTiers(value); setCodePage(1) }}
          data-tier-filter maxTagCount="responsive" /> : null}
        {/* 官网页筛选（用户 2026-11-19）：与国家和分级同一形态；三档与列同义，清空即全部。 */}
        {tab === 'codes' ? <Select mode="multiple" allowClear size="small" className="mi-catalog__filter-select"
          value={[...officials]} aria-label={text.officialFilterMulti} placeholder={text.officialFilterMulti}
          options={officialOptions} onChange={(value) => { setOfficials(value); setCodePage(1) }}
          data-official-filter maxTagCount="responsive" /> : null}
      </div>
      <div className="mi-catalog__table">{body}</div>
      <div className="mi-catalog__footer">
        <Button size="small" className="mi-catalog__export" data-catalog-export
          // **三份里有一份读不到就不给导出**：导出是「全量」，悄悄少一张工作表比不让导更糟。
          disabled={view?.state !== 'available' || codes?.state !== 'available' || events?.state !== 'available'
            || (codeCount === 0 && unmappedCount === 0 && eventCount === 0)}
          onClick={() => {
            // 导出的是**三张表的全量**，与筛选、页码、当前页签无关。
            const sheets = [
              { name: text.sheetCodes, rows: codeTableExportRows(codes?.state === 'available' ? codes.rows : [], {
                columns: text.codeColumns, status: text.codeStatus, officialPending: text.officialPending,
                officialNone: text.officialNone, unknownCountry: '—',
                nameZh: text.exportNameZh, nameEn: text.exportNameEn,
                tierStars: text.tierStars, tierNames: text.tierNames
              }) },
              { name: text.sheetUnmapped, rows: unmappedExportRows(view?.state === 'available' ? view.unmapped : [], {
                columns: text.unmappedColumns, reasons: text.unmappedReasons,
                reasonUnknown: text.statusUnknown, firstSeenUnknown: text.statusUnknown,
                formatTime: (instant) => formatTime(instant, 'second')
              }) },
              { name: text.sheetEvents, rows: eventExportRows(events?.state === 'available' ? events.rows : [], {
                columns: text.eventColumns, statusLabels: text.eventStatus,
                statusUnknown: text.statusUnknown, titleMissing: text.eventTitleMissing
              }, (row) => eventTimeCell(row, formatTime)) }
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
