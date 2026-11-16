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
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { MappingRulesDialog } from './MappingRulesDialog'

/**
 * 导出与排序的界面判据：
 *
 * 1. 点一次「导出 Excel」，文件里**两张工作表都在**，各自行数正确（只核第一张等于没验第二张）；
 * 2. 表里的顺序就是读者要的「行数降序」，不是读口给的顺序；
 * 3. 分级筛选只出现在「已映射」——未映射的 id 还没有分级。
 */
const mkDay = macroIndicatorDrawerText['zh-CN'].mkDay
const text = {
  title: mkDay.mappingTitle, filter: mkDay.mappingFilter,
  mapped: mkDay.mappingMapped, unmapped: mkDay.mappingUnmapped,
  mappedEmpty: mkDay.mappingMappedEmpty, unmappedEmpty: mkDay.mappingUnmappedEmpty,
  unavailable: mkDay.mappingUnavailable,
  columns: mkDay.mappingColumns, tiers: mkDay.mappingTiers, unmappedColumns: mkDay.mappingUnmappedColumns,
  tabMapped: mkDay.mappingTabMapped, tabUnmapped: mkDay.mappingTabUnmapped, tabsAria: mkDay.mappingTabsAria,
  exportLabel: mkDay.mappingExport, exportEmpty: mkDay.mappingExportEmpty,
  tierFilter: mkDay.mappingTierFilter,
  sheetMapped: mkDay.mappingSheetMapped, sheetUnmapped: mkDay.mappingSheetUnmapped
}
const view: MappingRulesRead = {
  state: 'available',
  mapped: [
    { sourceId: '10113', metricKey: 'US.MICHIGAN.NONE.LEVEL', periodRule: 'month', basis: null, officialUrl: null, names: null, tier: null, rowCount: 0 },
    { sourceId: '214790', metricKey: 'US.CPI.NSA.YOY', periodRule: 'month', basis: 'BLS · 发布页', officialUrl: null, names: { zh: 'CPI 年率', en: 'Consumer Price Index (CPI), YoY' }, tier: 1, rowCount: 12 },
    { sourceId: '4013', metricKey: 'US.PPI.NSA.YOY', periodRule: 'month', basis: null, officialUrl: null, names: null, tier: 2, rowCount: 5 }
  ],
  unmapped: [{ sourceId: '10267', rowCount: 8, sampleLabel: '5-10 年通胀预期', sampleLabelEn: null }],
  counts: { mapped: 3, unmapped: 1, unmappedRows: 8 }
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
      <MappingRulesDialog open onClose={() => undefined} text={text} view={view} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
}

const dataRows = (): string[] => [...(document.body.querySelector('[data-mapping-section="mapped"]')
  ?.querySelectorAll('tbody tr.ant-table-row') ?? [])].map((row) => row.textContent ?? '')

it('shows the rows in rows-in-store order, not in read order', async () => {
  await mount()
  const rows = dataRows()
  expect(rows).toHaveLength(3)
  // 12 行的 CPI 排第一，其次 5 行的 PPI，0 行的密歇根垫底——这是读者问的那个顺序。
  expect(rows[0]).toContain('214790')
  expect(rows[1]).toContain('4013')
  expect(rows[2]).toContain('10113')
})

it('offers the tier filter on the mapped tab only', async () => {
  await mount()
  expect(document.body.querySelector('[data-tier-filter]')).not.toBeNull()
  const tabs = [...document.body.querySelectorAll('[role="tab"]')]
  const unmappedTab = tabs.find((tab) => (tab.textContent ?? '').includes('未映射'))!
  await act(async () => { (unmappedTab as HTMLElement).click() })
  // 未映射的 id 还没有分级：给它一个分级筛选器，这个控件就在撒谎。
  expect(document.body.querySelector('[data-tier-filter]')).toBeNull()
})

it('exports one file with both worksheets, each carrying its own rows', async () => {
  await mount()
  const button = document.body.querySelector('[data-catalog-export]') as HTMLElement
  expect(button).not.toBeNull()
  await act(async () => { button.click() })
  await act(async () => { await Promise.resolve() })
  expect(saved, '导出没有走到保存桥').toBeDefined()
  expect(saved!.name).toMatch(/^映射规则-\d{4}-\d{2}-\d{2}\.xlsx$/u)

  const dir = mkdtempSync(join(tmpdir(), 'mapping-export-'))
  const file = join(dir, 'out.xlsx')
  writeFileSync(file, saved!.bytes)
  execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'un')], { stdio: 'pipe' })
  // 两张工作表都在文件里。
  expect(readdirSync(join(dir, 'un', 'xl', 'worksheets'))).toEqual(['sheet1.xml', 'sheet2.xml'])
  const workbook = readFileSync(join(dir, 'un', 'xl', 'workbook.xml'), 'utf8')
  expect(workbook).toContain('name="已映射"')
  expect(workbook).toContain('name="未映射"')
  const first = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet1.xml'), 'utf8')
  const second = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet2.xml'), 'utf8')
  // 已映射：1 行表头 + 3 行数据；未映射：1 行表头 + 1 行数据。
  expect((first.match(/<row /gu) ?? []).length).toBe(4)
  expect((second.match(/<row /gu) ?? []).length).toBe(2)
  // 两张表各自装自己的东西，不是把同一份抄两遍。
  expect(first).toContain('US.CPI.NSA.YOY')
  expect(second).not.toContain('US.CPI.NSA.YOY')
  expect(second).toContain('5-10 年通胀预期')
})
