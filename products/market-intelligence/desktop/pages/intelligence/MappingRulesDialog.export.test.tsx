// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import type { MappingRulesRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarMappingRulesRead'
import type { CalendarEventListRead } from '../../../service/intelligence/macro-calendar/rendering/marketCalendarEventListRead'
import type {
  CodeTableRead, CodeTableReadRow
} from '../../../service/intelligence/macro-calendar/rendering/marketCalendarCodeTableRead'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { MappingRulesDialog } from './MappingRulesDialog'

/**
 * 码表 / 未映射两个页签的判据（用户 2026-11-17）：
 *
 * 1. 「已映射」整块没了，第一页是**码表**（一个码一行）；
 * 2. 官网页三态都不留空链接：`查看`（真链接）/ `待核`（纯文字，理由在 title）/ `—`（不建、退役）；
 * 3. **源 id 数 0 照样显示 0**——那是「没有任何源认得它」，是这张表最有用的一格；
 * 4. 码列中段省略但末段留着（`.YOY` 不能被切掉）；导出是两张表的全量，不看筛选。
 */
const mkDay = macroIndicatorDrawerText['zh-CN'].mkDay
const text = {
  title: mkDay.mappingTitle, filter: mkDay.mappingFilter,
  tabCodes: mkDay.mappingTabCodes, tabUnmapped: mkDay.mappingTabUnmapped,
  tabsAria: mkDay.mappingTabsAria, unavailable: mkDay.mappingUnavailable,
  countryNote: mkDay.mappingCodeCountryNote, codeColumns: mkDay.mappingCodeColumns, codeStatus: mkDay.mappingCodeStatus,
  onlyWithData: mkDay.mappingOnlyWithData, unknownCountry: '未知国家',
  officialOpen: mkDay.mappingOfficialOpen, officialPending: mkDay.mappingOfficialPending,
  officialNone: mkDay.mappingOfficialNone, codeEmpty: mkDay.mappingCodeEmpty,
  unmappedColumns: mkDay.mappingUnmappedColumns, unmappedEmpty: mkDay.mappingUnmappedEmpty,
  unmappedReasons: mkDay.mappingUnmappedReasons, reasonFilter: mkDay.mappingReasonFilter,
  reasonAll: mkDay.mappingReasonAll,
  tierStars: mkDay.mappingTierStars, tierAria: mkDay.mappingTierAria,
  tierFilterMulti: mkDay.mappingTierFilterMulti, countryFilterMulti: mkDay.mappingCountryFilterMulti,
  officialFilterMulti: mkDay.mappingOfficialFilterMulti,
  officialStates: { checked: mkDay.mappingOfficialChecked, pending: mkDay.mappingOfficialPending, none: mkDay.mappingOfficialNone },
  countryAll: mkDay.mappingCountryAll, countryFilter: mkDay.mappingCountryFilter,
  exportLabel: mkDay.mappingExport,
  resolveCopy: (key: string) => (mkDay as unknown as Readonly<Record<string, string>>)[key] ?? key,
  sheetCodes: mkDay.mappingSheetCodes, sheetUnmapped: mkDay.mappingSheetUnmapped,
  tabEvents: mkDay.mappingTabEvents, eventColumns: mkDay.mappingEventColumns,
  eventsEmpty: mkDay.mappingEventsEmpty, sheetEvents: mkDay.mappingSheetEvents,
  eventTitleMissing: mkDay.mappingEventTitleMissing,
  tierNames: mkDay.mappingTierNames,
  exportNameZh: mkDay.mappingExportNameZh, exportNameEn: mkDay.mappingExportNameEn,
  statusUnknown: mkDay.mappingStatusUnknown,
  // 发布状态的白话名与日历行共用一份（这里用产品文案表里的同一条）。
  eventStatus: { published: '已发布', scheduled: '待发布', missing: '未提供', backfilling: '待补值' }
}
const codeRow = (code: string, extra: Partial<CodeTableReadRow> = {}): CodeTableReadRow => ({
  code, kind: 'metric' as const,
  names: { zhFull: '核心 PCE 年率', zhShort: '核心 PCE', enFull: 'Core PCE (YoY)', enShort: 'Core PCE' },
  countryCode: 'US', countryName: '美国',
  tier: 1 as const, measure: 'YOY', seasonality: 'NSA', status: 'active' as const, reason: null,
  releaseRowCount: 12,
  officialSource: { agency: 'BEA', url: 'https://www.bea.gov/x', pageKind: 'release' as const,
    verifiedAt: '2026-11-17', basis: '发布目录' },
  sourceIdCount: 2, ...extra
})
const codes: CodeTableRead = {
  state: 'available',
  rows: [
    codeRow('US.CORE_PCE.NSA.YOY'),
    // 这条没有源认得、库里也没有发布行：两格都要写 0（不是空、不是「待补」）。
    codeRow('US.NO_SOURCE.NONE.LEVEL', { status: 'pending', reason: 'official-source-todo', countryCode: null, countryName: null, releaseRowCount: 5,
      officialSource: { pending: true, reason: 'official-source-todo' }, sourceIdCount: 0 }),
    codeRow('US.NOT_BUILT.NONE.LEVEL', { status: 'not-built', reason: 'no-reader', countryCode: null, countryName: null, releaseRowCount: 0,
      officialSource: { pending: true, reason: 'official-source-todo' }, sourceIdCount: 0 })
  ],
  counts: { total: 3, metric: 3, event: 0, withOfficialSource: 1, pendingOfficialSource: 2 }
}
const view: MappingRulesRead = {
  state: 'available',
  mapped: [],
  unmapped: [{ sourceId: '10267', rowCount: 8, firstSeenAt: '2026-11-17T02:00:00.000Z',
    providerIds: ['0xrouter'], reason: 'no-code' as const,
    sampleLabel: '5-10 年通胀预期', sampleLabelEn: null }],
  counts: { mapped: 0, unmapped: 1, unmappedRows: 8, eventIdentities: 99,
    diagnostics: { 'no-standard-row': 0, 'period-unresolved': 0, 'no-code': 1 } }
}

/** 事件页签的夹具：一行 = 一场事件；没有期次、没有码。 */
const events: CalendarEventListRead = {
  state: 'available',
  rows: [
    { key: 'US|evt.fomc|2026-10-29|2026-10-29', eventType: 'central-bank-activity',
      scheduledDate: '2026-10-29', scheduledAt: '2026-10-29T18:00:00.000Z',
      countryCode: 'US', countryName: '美国', title: 'FOMC 会议', titleEn: null,
      sourceProviderId: '0xrouter', status: 'published' },
    // 日期精度 + 没有国家 + 源没给标题：三格都要有确定说法，不能留空、不能编。
    { key: 'ZZ|["44735",75559]|2026-10-14|2026-10-14', eventType: 'financial-event',
      scheduledDate: '2026-10-14', scheduledAt: null,
      countryCode: null, countryName: null, title: null, titleEn: null,
      sourceProviderId: '0xrouter', status: 'unknown' }
  ],
  total: 2
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let saved: { name: string; bytes: Uint8Array } | undefined

beforeEach(() => {
  saved = undefined
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}) }) as DOMRect
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: { app: { saveFile: vi.fn(async (name: string, bytes: Uint8Array) => { saved = { name, bytes }; return { saved: true } }) } }
  })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined; host?.remove(); document.body.innerHTML = ''
})

async function mount(shown: MappingRulesRead = view): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MappingRulesDialog open onClose={() => undefined} text={text} view={shown} codes={codes} events={events} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
}

const rows = (): Element[] => [...(document.body.querySelector('[data-mapping-section="codes"]')
  ?.querySelectorAll('tbody tr.ant-table-row') ?? [])]

it('replaces the old first tab with the code table, one row per code', async () => {
  await mount()
  const tabs = [...document.body.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? '')
  expect(tabs.some((label) => label.includes('码表'))).toBe(true)
  // 「已映射」整块删掉了：页签里不该再有它。
  expect(tabs.some((label) => label.includes('已映射'))).toBe(false)
  expect(rows()).toHaveLength(3)
})

it('keeps the code tail visible, and never leaves the official cell blank or a dead link', async () => {
  await mount()
  const body = rows()
  // 短码原样；长码中段省略但**末段必须留着**——`.YOY` 被切掉，两个码就分不出来了。
  expect(body[0]!.querySelector('[data-code]')?.textContent).toBe('US.CORE_PCE.NSA.YOY')
  expect(body[0]!.querySelector('[data-code]')?.getAttribute('title')).toBe('US.CORE_PCE.NSA.YOY')
  expect(body[0]!.querySelector('[data-official]')?.getAttribute('href')).toBe('https://www.bea.gov/x')
  expect(body[0]!.querySelector('[data-official]')?.textContent).toBe('查看')
  // 待补：纯文字，`title` 给理由，**没有 href**。
  const pending = body[1]!.querySelector('[data-official-pending]')!
  expect(pending.textContent).toBe('待核')
  expect(pending.getAttribute('title')).toBe('official-source-todo')
  expect(pending.getAttribute('href')).toBeNull()
  // 不建/退役：破折号，没有链接。
  expect(body[2]!.querySelector('[data-official], [data-official-pending]')).toBeNull()
  // 国家列在名称之前；读口给 null 时写「未知国家」，不空着。
  expect(body[0]!.querySelectorAll('td')[1]?.textContent).toContain('美国')
  expect(body[1]!.querySelector('[data-country-empty]')?.textContent).toBe('—')
  // **源 id 数 0 显示 0**，不是空；**数据量 0 也写 0**（它是最后一列，紧挨源 id 数）。
  const cellAt = (row: Element, index: number): string => row.querySelectorAll('td')[index]?.textContent ?? ''
  expect(cellAt(body[1]!, 7)).toBe('0')
  expect(cellAt(body[0]!, 7)).toBe('2')
  expect(cellAt(body[1]!, 8)).toBe('5')
  expect(cellAt(body[0]!, 8)).toBe('12')
})

it('exports both sheets in full even when the table is filtered', async () => {
  await mount()
  const input = document.body.querySelector('.mi-catalog__filters input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '核心 PCE')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(rows().length).toBeGreaterThan(0)

  // 这句说明在 ⓘ 里，不在正文：正文出现它就会把页脚变成一行说明书。
  expect(document.body.textContent).not.toContain('全部行')
  expect(document.body.querySelector('[data-export-scope] [aria-label]')).not.toBeNull()
  const button = document.body.querySelector('[data-catalog-export]') as HTMLElement
  await act(async () => { button.click() })
  await act(async () => { await Promise.resolve() })
  expect(saved!.name).toMatch(/^映射规则-\d{4}-\d{2}-\d{2}\.xlsx$/u)

  const dir = mkdtempSync(join(tmpdir(), 'code-export-'))
  const file = join(dir, 'out.xlsx')
  writeFileSync(file, saved!.bytes)
  execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'un')], { stdio: 'pipe' })
  // 三个页签三张表：导出不能少一张（少一张就是悄悄丢数据）。
  expect(readdirSync(join(dir, 'un', 'xl', 'worksheets'))).toEqual(['sheet1.xml', 'sheet2.xml', 'sheet3.xml'])
  const workbook = readFileSync(join(dir, 'un', 'xl', 'workbook.xml'), 'utf8')
  expect(workbook).toContain('name="码表"')
  expect(workbook).toContain('name="未映射"')
  expect(workbook).toContain('name="事件"')
  // 行数是**全量**：1 行表头 + 3 个码、1 + 1 个未映射 id、1 + 2 个事件。
  const first = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet1.xml'), 'utf8')
  const second = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet2.xml'), 'utf8')
  const third = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet3.xml'), 'utf8')
  expect((first.match(/<row /gu) ?? []).length).toBe(4)
  expect((second.match(/<row /gu) ?? []).length).toBe(2)
  expect((third.match(/<row /gu) ?? []).length).toBe(3)
})

/**
 * 用户 2026-11-17 的四条：展开后八列同屏、分级与口径分开、国家筛选、数据量列。
 *
 * 这一条钉**界面结构**：列头九格（码/国家/名称/分级/口径/官网页/状态/源 id 数/数据量）、
 * 数据量紧挨源 id 数且**列头可点排序**、国家下拉默认「全部国家」。
 * 真机观感（一屏能不能同屏看清）归用户看，这里只保证结构在。
 */
it('shows nine columns with data volume next to source ids, sortable, and a country filter', async () => {
  await mount()
  // 两个页签的表格都在 DOM 里（非活动的只加 hidden），所以**限定在码表那一段**里数。
  const codeSection = document.body.querySelector('[data-mapping-section="codes"]')!
  const headerCells = [...codeSection.querySelectorAll('.ant-table-thead th')]
    .map((cell) => cell.textContent ?? '')
  expect(headerCells).toEqual(['码', '国家', '名称', '分级', '口径', '官网页', '状态', '源 id 数', '数据量'])

  // 列头可点排序：点「数据量」把 0 的那条换到最前（默认顺序按码，不动）。
  const rowsBefore = [...codeSection.querySelectorAll('.ant-table-tbody tr.ant-table-row')]
    .map((row) => row.querySelector('[data-code]')?.textContent ?? '')
  expect(rowsBefore[0]).toContain('CORE_PCE')
  const volumeHeader = headerCells.indexOf('数据量')
  await act(async () => {
    codeSection.querySelectorAll('.ant-table-thead th')[volumeHeader]!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }))
  })
  const rowsAfter = [...codeSection.querySelectorAll('.ant-table-tbody tr.ant-table-row')]
    .map((row) => row.querySelector('[data-code]')?.textContent ?? '')
  expect(rowsAfter[0], '排序后 0 数据量的码应在最前').not.toBe(rowsBefore[0])

  // 国家下拉存在、默认「全部国家」，选项与数据同一份（美国 / 未知国家）。
  const select = document.body.querySelector('[data-country-filter]')
  expect(select, '没有国家筛选取').not.toBeNull()
  expect(document.body.textContent).toContain('按国家筛选（可多选）')
  expect(document.body.textContent).toContain('按分级筛选（可多选）')
})

/**
 * 码表默认按**数据量降序**，并且「只看有数据的」能把 0 行的码收起来（用户 2026-11-18）：
 * 860 个码里近 290 个一行数据都没有，按码名排序时最上面全是空壳，第一眼看不到有内容的行。
 */
it('orders the code table by data volume and can hide codes that have no rows', async () => {
  await mount()
  const codesText = (): string[] => rows().map((row) => row.querySelectorAll('td')[0]?.textContent ?? '')
  // 12 行的核心 PCE 在最上，0 行的不建码垫底。
  expect(codesText()[0]).toContain('US.CORE_PCE')
  expect(codesText().at(-1)).toContain('US.NOT_BUILT')

  const toggle = document.body.querySelector('[data-only-with-data] input') as HTMLInputElement
  expect(toggle, '没有「只看有数据的」开关').not.toBeNull()
  await act(async () => { toggle.click() })
  await act(async () => { await Promise.resolve() })
  // 0 行的那条被收起来，剩下的都真有数据。
  expect(rows()).toHaveLength(2)
  expect(document.body.textContent).not.toContain('US.NOT_BUILT')
})

/**
 * 未映射页签的两条要求（用户 2026-11-18）：
 * **长期空是正常状态**——空状态要说明用途，不能只写「没有数据」，否则读者以为我们没做好；
 * 有内容时每行要能判断「该建码还是该归事件」——所以带首次出现时间、来源、标题原文。
 */
it('explains the empty state and shows first-seen, sources and the raw title on a row', async () => {
  await mount()
  const unmappedTab = [...document.body.querySelectorAll('[role="tab"]')]
    .find((tab) => (tab.textContent ?? '').includes('未映射')) as HTMLElement
  await act(async () => { unmappedTab.click() })
  const section = document.body.querySelector('[data-mapping-section="unmapped"]')!
  // 行内：标题原文 + 来源 + 首次出现（时间由平台格式化，不手拼）。
  expect(section.textContent).toContain('5-10 年通胀预期')
  expect(section.textContent).toContain('0xrouter')
  expect(section.textContent).toMatch(/\d{4}/u)

  // 空状态：说清用途，不是一句「没有数据」。
  await act(async () => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
  await mount({ ...view, unmapped: [],
    counts: { ...view.counts, unmapped: 0, unmappedRows: 0 } } as MappingRulesRead)
  const emptyTab = [...document.body.querySelectorAll('[role="tab"]')]
    .find((tab) => (tab.textContent ?? '').includes('未映射')) as HTMLElement
  await act(async () => { emptyTab.click() })
  expect(document.body.textContent).toContain('暂无未收录的新事件')
  // **主列表就是「所有没进日历的」**（用户 2026-11-18 最终口径）：空态只在真的 0 条时出现。
  // 这一例把 unmapped 清空，才该看到那句空态文案；非空时列表直接列。
  expect(document.body.textContent).toContain('暂无未收录的新事件')
})

/**
 * 分级用星级（用户 2026-11-18）：列里 `★★★/★★/★/—`，读屏名写全；两个筛选项都是多选。
 * 同一筛选内部是「或」，两个筛选之间是「且」。
 */
it('shows tiers as stars with a spoken label, and both filters are multi-select', async () => {
  await mount()
  const stars = document.body.querySelector('[data-tier]')!
  expect(stars.textContent).toBe('★★★')
  expect(stars.getAttribute('aria-label')).toBe('一级（三颗星）')
  // 下拉里必须是「★★★ 一级」这种星级 + 文字：只写星星，读者按「一级」找会以为没有这一档。
  // 选项在展开后渲染到 body 上的弹层里，所以先点开再找。
  const tierFilter = document.body.querySelector('[data-tier-filter] .ant-select-selector') as HTMLElement
  await act(async () => { tierFilter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  const optionTexts = [...document.querySelectorAll('.ant-select-item-option')].map((node) => node.textContent ?? '')
  // 只断「星级 + 文字」这一条：下拉是虚拟列表，happy-dom 里只挂可见的那几项，
  // 断「未分级也在」会红在一件与文案无关的事上（真机由用户看）。
  expect(optionTexts).toContain('★★★ 一级')
  // 两个筛选项都是多选：antd 多选的可清除标签容器与单选不同，用属性区分。
  expect(document.body.querySelector('[data-country-filter]')?.className).toContain('ant-select-multiple')
  expect(document.body.querySelector('[data-tier-filter]')?.className).toContain('ant-select-multiple')
})

/**
 * 第三个页签（用户 2026-11-18：「所有经济事件、央行活动，给我单独一个tab出来，这个不用映射」）。
 *
 * 判据三条：事件 tab 存在且带条数；一行一场、列是 时间/国家/标题/来源/状态；**没有原因与分级筛选**
 * ——事件没有统计期、没有码，那两样筛选在这一页没有意义。
 */
it('lists events on their own tab, without the mapping-only filters', async () => {
  await mount()
  const tabs = [...document.body.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? '')
  expect(tabs.some((label) => label.includes('事件'))).toBe(true)
  const eventsTab = [...document.body.querySelectorAll('[role="tab"]')]
    .find((tab) => (tab.textContent ?? '').includes('事件')) as HTMLElement
  await act(async () => { eventsTab.click() })
  const section = document.body.querySelector('[data-mapping-section="events"]')!
  const headers = [...section.querySelectorAll('.ant-table-thead th')].map((cell) => cell.textContent ?? '')
  expect(headers).toEqual(['时间', '国家', '标题', '来源', '状态'])
  const body = [...section.querySelectorAll('tbody tr.ant-table-row')]
  expect(body).toHaveLength(2)
  // 有时刻的那条按读者时区显示到分钟；日期精度那条**不显示假时刻**（只显示日期）。
  expect(body[0]!.querySelector('[data-event-time]')?.textContent).toMatch(/\d{2}:\d{2}/u)
  expect(body[1]!.querySelector('[data-event-time]')?.textContent).not.toMatch(/\d{2}:\d{2}/u)
  // 拿不到的三格各有确定说法：国家 `—`、标题「源未提供标题」、状态「无法确认」。
  expect(body[1]!.querySelector('[data-country-empty]')?.textContent).toBe('—')
  expect(body[1]!.querySelector('[data-event-title-missing]')?.textContent).toBe('源未提供标题')
  expect(body[1]!.querySelector('[data-event-status]')?.textContent).toBe('无法确认')
  // 这一页没有原因筛选、没有分级筛选（它们属于「该归到码上的数据」那一页）。
  expect(document.body.querySelector('[data-reason-filter]')).toBeNull()
  expect(document.body.querySelector('[data-tier-filter]')).toBeNull()
})

/**
 * 官网页筛选（用户 2026-11-19）：多选、选项只列真实出现过的档、与其他筛选「且」、清空回全量。
 *
 * 三档与那一列同义：`已核`（有机构页）/ `待核`（还没核到）/ `—`（不建或退役，没有页）。
 */
async function pickFilterOption(filter: string, label: string): Promise<void> {
  const selector = document.body.querySelector(`${filter} .ant-select-selector`) as HTMLElement
  await act(async () => { selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  const option = [...document.querySelectorAll('.ant-select-item-option')]
    .find((node) => (node.textContent ?? '').trim() === label) as HTMLElement | undefined
  expect(option, `下拉里没有「${label}」这一项`).toBeDefined()
  await act(async () => { option!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

const visibleCodes = (): string[] => rows().map((row) => row.querySelector('[data-code]')?.getAttribute('title') ?? '')

it('filters the code table by official page, alone and together with the country filter', async () => {
  await mount()
  expect(visibleCodes()).toHaveLength(3)

  // ① 只看「待核」→ 只剩没有官网页的那条。
  await pickFilterOption('[data-official-filter]', '待核')
  expect(visibleCodes()).toEqual(['US.NO_SOURCE.NONE.LEVEL'])

  // ② 再勾「已核」→ 同一筛选内部是「或」：两条都在；「不建」那条仍然不在。
  await pickFilterOption('[data-official-filter]', '已核')
  expect(visibleCodes().sort()).toEqual(['US.CORE_PCE.NSA.YOY', 'US.NO_SOURCE.NONE.LEVEL'])

  // ③ 清空 → 回到全量。
  const clear = document.body.querySelector('[data-official-filter] .ant-select-clear') as HTMLElement | null
  expect(clear, '多选框应当有清除按钮').not.toBeNull()
  await act(async () => { clear!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  expect(visibleCodes()).toHaveLength(3)

  // ④ 国家 + 官网页同时选 → 取交集（美国 + 待核 = 只有那条）。
  // 夹具里「待核」那条没有国家：先按国家选美国，再勾「已核」→ 只有核心 PCE 一条。
  await pickFilterOption('[data-country-filter]', '美国')
  await pickFilterOption('[data-official-filter]', '已核')
  expect(visibleCodes()).toEqual(['US.CORE_PCE.NSA.YOY'])
})
