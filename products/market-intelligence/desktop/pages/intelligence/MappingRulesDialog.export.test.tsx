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
  childSuffix: mkDay.mappingChildSuffix,
  sheetMapped: mkDay.mappingSheetMapped, sheetUnmapped: mkDay.mappingSheetUnmapped
}
const view: MappingRulesRead = {
  state: 'available',
  mapped: [
    // 一个码一行：这条有三个 id，格子用 ` · ` 连起来。
    { sourceIds: ['213623', '214135', '214386'], metricKey: 'US.MICHIGAN.NONE.LEVEL', periodRule: 'month',
      basis: null, officialUrl: null, names: null, tier: null, rowCount: 0 },
    { sourceIds: ['214790'], metricKey: 'US.CPI.NSA.YOY', periodRule: 'month', basis: 'BLS · 发布页',
      officialUrl: null, names: { zh: 'CPI 年率', en: 'Consumer Price Index (CPI), YoY' }, tier: 1, rowCount: 12 },
    // 只有码、没有任何源内 id 的行：两格空着（空 = 它本来就没有 id）。
    { sourceIds: [], metricKey: 'US.PCE.SA.MOM', periodRule: null, basis: null,
      officialUrl: null, names: null, tier: 2, rowCount: 5 }
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

async function mount(shown: MappingRulesRead = view): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MappingRulesDialog open onClose={() => undefined} text={text} view={shown} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
}

const dataRows = (): string[] => [...(document.body.querySelector('[data-mapping-section="mapped"]')
  ?.querySelectorAll('tbody tr.ant-table-row') ?? [])].map((row) => row.textContent ?? '')
const dataRowNodes = (): Element[] => [...(document.body.querySelector('[data-mapping-section="mapped"]')
  ?.querySelectorAll('tbody tr.ant-table-row') ?? [])]

it('shows the rows in rows-in-store order, not in read order', async () => {
  await mount()
  const rows = dataRows()
  expect(rows).toHaveLength(3)
  // 12 行的 CPI 排第一；两条 5 行的是「未分级(0 条?)」…按同体量比分级：二级那条在前，未分级垫底。
  expect(rows[0]).toContain('US.CPI.NSA.YOY')
  expect(rows[1]).toContain('US.PCE.SA.MOM')
  expect(rows[2]).toContain('US.MICHIGAN.NONE.LEVEL')
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

/**
 * 子母项（Chief 2026-11-17）：名称格里给归属小字，母项排在自己分项前面，
 * 搜母指标名时它的分项一起出来（搜子项只出子项）。
 */
const phillyParent = 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL'
const familyView: MappingRulesRead = {
  state: 'available',
  mapped: [
    { sourceIds: ['c0'], metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'month',
      basis: null, officialUrl: null, names: { zh: '费城联储制造业装船', en: 'Philly Fed Shipments' },
      tier: null, rowCount: 3, kind: 'child', parentMetricKey: phillyParent, childOrder: 0 },
    { sourceIds: ['p1'], metricKey: phillyParent, periodRule: 'month', basis: null, officialUrl: null,
      names: { zh: '费城联储制造业指数', en: 'Philly Fed Manufacturing Index' },
      tier: 1, rowCount: 9, kind: 'parent', parentMetricKey: null },
    { sourceIds: ['c1'], metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'month',
      basis: null, officialUrl: null, names: { zh: '费城联储制造业新订单', en: 'Philly Fed New Orders' },
      tier: null, rowCount: 2, kind: 'child', parentMetricKey: phillyParent, childOrder: 1 },
    { sourceIds: ['other'], metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodRule: 'month', basis: null, officialUrl: null,
      names: { zh: '失业率', en: 'Unemployment Rate' }, tier: 1, rowCount: 13 }
  ],
  unmapped: [],
  counts: { mapped: 4, unmapped: 0, unmappedRows: 0 }
}

it('puts a parent ahead of its children and shows the owning parent as small text', async () => {
  await mount(familyView)
  const rows = dataRows()
  expect(rows).toHaveLength(4)
  // 行数最多的族在最前（失业率 13 行），其余三行是费城那一族且母项带头。
  expect(rows[0]).toContain('US.UNEMPLOYMENT.SA.RATE')
  expect(rows[1]).toContain(phillyParent)
  // 子项带归属小字：母指标名 + 「· 子项」；母项自己不重复一遍自己的名字。
  expect(rows[2]).toContain('费城联储制造业装船')
  expect(rows[2]).toContain('费城联储制造业指数 · 子项')
  expect(rows[1]).not.toContain('· 子项')
})

it('brings the children along when the search matches the parent only', async () => {
  await mount(familyView)
  const input = document.body.querySelector('.mi-catalog__filters input') as HTMLInputElement
  expect(input).not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '费城联储制造业指数')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // 母项名里带「费城联储制造业指数」，子项名里是「费城联储制造业装船」——不含母名的整串，必须靠父带子补齐。
  const rows = dataRows()
  expect(rows).toHaveLength(3)
  expect(rows[0]).toContain(phillyParent)
  expect(rows[1]).toContain('US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL')
})

it('lists every source id a code answers to, and leaves the cell blank for a code with none', async () => {
  await mount()
  const rows = dataRows()
  // 一个码一行：三个 id 用 ` · ` 连在一格，不拆成三行。
  const michigan = rows.find((row) => row.includes('US.MICHIGAN.NONE.LEVEL'))!
  expect(michigan).toContain('213623 · 214135 · 214386')
  // 只有码、没有 id 的行：这一格空着（空表示它本来就没有 id，不是读失败），期次规则那格也空着。
  const pce = dataRowNodes().find((row) => (row.textContent ?? '').includes('US.PCE.SA.MOM'))!
  expect(pce.textContent ?? '').not.toContain('·')
  expect(pce.querySelectorAll('td')[0]?.textContent, '源内 id 格应为空').toBe('')
  expect(pce.querySelectorAll('td')[4]?.textContent, '期次规则格应为空').toBe('')
})
