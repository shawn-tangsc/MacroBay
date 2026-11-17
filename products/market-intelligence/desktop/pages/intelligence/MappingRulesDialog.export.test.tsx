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
  codeColumns: mkDay.mappingCodeColumns, codeStatus: mkDay.mappingCodeStatus,
  unknownCountry: '未知国家',
  officialOpen: mkDay.mappingOfficialOpen, officialPending: mkDay.mappingOfficialPending,
  officialNone: mkDay.mappingOfficialNone, codeEmpty: mkDay.mappingCodeEmpty,
  unmappedColumns: mkDay.mappingUnmappedColumns, unmappedEmpty: mkDay.mappingUnmappedEmpty,
  countryAll: mkDay.mappingCountryAll, countryFilter: mkDay.mappingCountryFilter,
  exportLabel: mkDay.mappingExport,
  resolveCopy: (key: string) => (mkDay as unknown as Readonly<Record<string, string>>)[key] ?? key,
  sheetCodes: mkDay.mappingSheetCodes, sheetUnmapped: mkDay.mappingSheetUnmapped
}
const codeRow = (code: string, extra: Partial<CodeTableReadRow> = {}): CodeTableReadRow => ({
  code, kind: 'metric' as const,
  names: { zhFull: '核心 PCE 年率', zhShort: '核心 PCE', enFull: 'Core PCE (YoY)', enShort: 'Core PCE' },
  countryCode: 'US', countryName: '美国',
  tier: 1 as const, measure: 'YOY', seasonality: 'NSA', status: 'active' as const, reason: null,
  officialSource: { agency: 'BEA', url: 'https://www.bea.gov/x', pageKind: 'release' as const,
    verifiedAt: '2026-11-17', basis: '发布目录' },
  sourceIdCount: 2, releaseRowCount: 12, ...extra
})
const codes: CodeTableRead = {
  state: 'available',
  rows: [
    codeRow('US.CORE_PCE.NSA.YOY'),
    // 这条没有源认得、库里也没有发布行：两格都要写 0（不是空、不是「待补」）。
    codeRow('US.NO_SOURCE.NONE.LEVEL', { status: 'pending', reason: 'official-source-todo', countryCode: null, countryName: null,
      officialSource: { pending: true, reason: 'official-source-todo' }, sourceIdCount: 0, releaseRowCount: 0 }),
    codeRow('US.NOT_BUILT.NONE.LEVEL', { status: 'not-built', reason: 'no-reader', countryCode: null, countryName: null,
      officialSource: { pending: true, reason: 'official-source-todo' }, sourceIdCount: 0 })
  ],
  counts: { total: 3, metric: 3, event: 0, withOfficialSource: 1, pendingOfficialSource: 2 }
}
const view: MappingRulesRead = {
  state: 'available',
  mapped: [],
  unmapped: [{ sourceId: '10267', rowCount: 8, sampleLabel: '5-10 年通胀预期', sampleLabelEn: null }],
  counts: { mapped: 0, unmapped: 1, unmappedRows: 8, eventIdentities: 99 } as never
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

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MappingRulesDialog open onClose={() => undefined} text={text} view={view} codes={codes} />
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
  expect(body[1]!.querySelectorAll('td')[1]?.textContent).toContain('未知国家')
  // **源 id 数 0 显示 0**，不是空；**数据量 0 也写 0**（它是最后一列，紧挨源 id 数）。
  const cellAt = (row: Element, index: number): string => row.querySelectorAll('td')[index]?.textContent ?? ''
  expect(cellAt(body[1]!, 7)).toBe('0')
  expect(cellAt(body[0]!, 7)).toBe('2')
  expect(cellAt(body[1]!, 8)).toBe('0')
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
  expect(readdirSync(join(dir, 'un', 'xl', 'worksheets'))).toEqual(['sheet1.xml', 'sheet2.xml'])
  const workbook = readFileSync(join(dir, 'un', 'xl', 'workbook.xml'), 'utf8')
  expect(workbook).toContain('name="码表"')
  expect(workbook).toContain('name="未映射"')
  // 行数是**全量**：1 行表头 + 3 个码、1 + 1 个未映射 id。
  const first = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet1.xml'), 'utf8')
  const second = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet2.xml'), 'utf8')
  expect((first.match(/<row /gu) ?? []).length).toBe(4)
  expect((second.match(/<row /gu) ?? []).length).toBe(2)
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
  expect(document.body.textContent).toContain('全部国家')
})
