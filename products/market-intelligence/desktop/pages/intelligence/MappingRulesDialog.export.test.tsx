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
  directColumns: mkDay.mappingDirectColumns, directEmpty: mkDay.mappingDirectEmpty, tabDirect: mkDay.mappingTabDirect,
  childSuffix: mkDay.mappingChildSuffix,
  sheetMapped: mkDay.mappingSheetMapped, sheetUnmapped: mkDay.mappingSheetUnmapped,
  sheetDirect: mkDay.mappingSheetDirect
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

/**
 * 「无需映射」这一段是「我们一共支持哪些指标」的答案（PCE、GDP、FOMC 不经过映射规则）。
 * 两条判据分开放：整段缺失时那个页签**不许出现**；有这一段时导出多一张工作表。
 */
const withDirect: MappingRulesRead = {
  ...view,
  direct: [
    { metricKey: 'US.PCE.SA.MOM', names: { zh: '核心 PCE 月率', en: 'PCE Price Index, MoM' }, tier: 1, rowCount: 7 },
    { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', names: null, tier: null, rowCount: 4 }
  ],
  counts: { ...view.counts, direct: 2 }
}

it('hides the third tab when the payload has no such section', async () => {
  await mount()
  const labels = [...document.body.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent ?? '')
  // 旧载荷没有这一段：不显示页签，也不画一张空表——「没有下发」和「一个都没有」不是同一件事。
  expect(labels.some((label) => label.includes('无需映射'))).toBe(false)
})

it('shows the third tab and exports a third worksheet when the section is there', async () => {
  await mount(withDirect)
  const tab = [...document.body.querySelectorAll('[role="tab"]')].find((node) => (node.textContent ?? '').includes('无需映射'))
  expect(tab, '无需映射页签没出现').toBeDefined()
  expect(tab!.textContent).toContain('2')
  await act(async () => { (tab as HTMLElement).click() })
  // 这一段没有源内 id：表里只有指标码、名称、分级、库里行数四列。
  const section = document.body.querySelector('[data-mapping-section="direct"]')
  expect(section?.textContent).toContain('US.PCE.SA.MOM')
  // 名称格：中文名 + 小字灰字英文名，**中间不再有「·」**（英文缺失时更不许留半个分隔符）。
  expect(section?.textContent).toContain('核心 PCE 月率')
  expect(section?.textContent).toContain('PCE Price Index, MoM')
  expect(section?.querySelector('.mi-name__en')?.textContent).toBe('PCE Price Index, MoM')
  // 名表查不到的行：名称格空着，分级显示「未分级」，行数照实写。
  expect(section?.textContent).toContain('未分级')
  expect(section?.textContent).toContain('US.GDP.SA.ANNUALIZED_QOQ')
  // 分级筛选在这一段也有（这一段的每行都有分级）。
  expect(document.body.querySelector('[data-tier-filter]')).not.toBeNull()

  const button = document.body.querySelector('[data-catalog-export]') as HTMLElement
  await act(async () => { button.click() })
  await act(async () => { await Promise.resolve() })
  const dir = mkdtempSync(join(tmpdir(), 'mapping-export-3-'))
  const file = join(dir, 'out.xlsx')
  writeFileSync(file, saved!.bytes)
  execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'un')], { stdio: 'pipe' })
  expect(readdirSync(join(dir, 'un', 'xl', 'worksheets')))
    .toEqual(['sheet1.xml', 'sheet2.xml', 'sheet3.xml'])
  const workbook = readFileSync(join(dir, 'un', 'xl', 'workbook.xml'), 'utf8')
  expect(workbook).toContain('name="已映射"')
  expect(workbook).toContain('name="未映射"')
  expect(workbook).toContain('name="无需映射"')
  const third = readFileSync(join(dir, 'un', 'xl', 'worksheets', 'sheet3.xml'), 'utf8')
  // 1 行表头 + 2 行数据，且只装这一段的指标。
  expect((third.match(/<row /gu) ?? []).length).toBe(3)
  expect(third).toContain('US.PCE.SA.MOM')
  expect(third).not.toContain('US.CPI.NSA.YOY')
})

/**
 * 子母项（Chief 2026-11-17）：名称格里给归属小字，母项排在自己分项前面，
 * 搜母指标名时它的分项一起出来（搜子项只出子项）。
 */
const phillyParent = 'US.PHILLY_FED_MANUFACTURING.SA.LEVEL'
const familyView: MappingRulesRead = {
  state: 'available',
  mapped: [
    { sourceId: 'c0', metricKey: 'US.PHILLY_FED_MANUFACTURING.SHIPMENTS.SA.LEVEL', periodRule: 'month',
      basis: null, officialUrl: null, names: { zh: '费城联储制造业装船', en: 'Philly Fed Shipments' },
      tier: null, rowCount: 3, kind: 'child', parentMetricKey: phillyParent, childOrder: 0 },
    { sourceId: 'p1', metricKey: phillyParent, periodRule: 'month', basis: null, officialUrl: null,
      names: { zh: '费城联储制造业指数', en: 'Philly Fed Manufacturing Index' },
      tier: 1, rowCount: 9, kind: 'parent', parentMetricKey: null },
    { sourceId: 'c1', metricKey: 'US.PHILLY_FED_MANUFACTURING.NEW_ORDERS.SA.LEVEL', periodRule: 'month',
      basis: null, officialUrl: null, names: { zh: '费城联储制造业新订单', en: 'Philly Fed New Orders' },
      tier: null, rowCount: 2, kind: 'child', parentMetricKey: phillyParent, childOrder: 1 },
    { sourceId: 'other', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodRule: 'month', basis: null, officialUrl: null,
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
