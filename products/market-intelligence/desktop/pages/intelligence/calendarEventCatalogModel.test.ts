import { describe, expect, it } from 'vitest'

import {
  EMPTY_CATALOG_FILTERS, filterCatalogRows, pageOf, sortCatalogRows, type CatalogRow
} from './calendarEventCatalogModel'

/**
 * 「事件目录」弹框的筛选与分页口径（Chief 2026-11-16 拍板）。
 *
 * 断的是规则本身，不是渲染：名称框命中四个字段任一、英文折叠大小写、按空格拆词且词可落在
 * 不同字段；四个字段都空时才退回源原文名；国家/重要性各自独立；页码超界夹回最后一页。
 */
const row = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  key: 'US.CPI.NSA.YOY',
  title: 'CPI 年率',
  titleIsSourceLabel: false,
  zhFull: '消费者物价指数（年率）',
  zhShort: 'CPI 年率',
  enFull: 'Consumer Price Index (YoY)',
  enShort: 'CPI YoY',
  countryLabel: '美国',
  countryCode: 'US',
  period: '2026-M10',
  lastRelease: '2026-11-12',
  importance: 'high',
  ...over
})

const id = (value: string) => row({ key: value, title: value })

describe('the catalog name filter', () => {
  it('matches any of the four name fields, in either language', () => {
    const target = row()
    for (const query of ['消费者物价指数', 'CPI 年率', 'Consumer Price', 'YoY', 'consumer price index']) {
      expect(filterCatalogRows([target], { ...EMPTY_CATALOG_FILTERS, name: query }), query).toHaveLength(1)
    }
    expect(filterCatalogRows([target], { ...EMPTY_CATALOG_FILTERS, name: '零售销售' })).toHaveLength(0)
  })

  it('splits the query into words, and each word may land on a different field', () => {
    // 「CPI」落在中文简称、「YoY」落在英文简称：两个词各命中不同字段，仍算命中。
    expect(filterCatalogRows([row()], { ...EMPTY_CATALOG_FILTERS, name: 'cpi yoy' })).toHaveLength(1)
    // 少一个词就不命中——按词全部命中，不做「任一词命中」。
    expect(filterCatalogRows([row()], { ...EMPTY_CATALOG_FILTERS, name: 'cpi retail' })).toHaveLength(0)
  })

  it('falls back to the source label only when all four name fields are empty', () => {
    const nameless = row({ key: '["212058",70663]', titleIsSourceLabel: true, zhFull: undefined, zhShort: undefined, enFull: undefined, enShort: undefined, sourceLabel: 'transmutation in seasonally adjusted unemployment' })
    // 那约 420 行只剩源原文名：按它搜得到，按英文名搜不到是**数据事实**，不是搜索坏了。
    expect(filterCatalogRows([nameless], { ...EMPTY_CATALOG_FILTERS, name: 'transmutation' })).toHaveLength(1)
    expect(filterCatalogRows([nameless], { ...EMPTY_CATALOG_FILTERS, name: 'unemployment rate yoy' })).toHaveLength(0)
    // 它们**不许被过滤掉**：空查询时仍在表里。
    expect(filterCatalogRows([nameless], EMPTY_CATALOG_FILTERS)).toHaveLength(1)
  })

  it('does not match across a field boundary, which is why the fields are not concatenated', () => {
    // 中文名结尾 + 英文名开头拼起来会造出假命中：这里断的是「不拼接」。
    const target = row({ zhFull: '消费者物价指数', zhShort: undefined, enFull: 'Index of retail sales', enShort: undefined })
    expect(filterCatalogRows([target], { ...EMPTY_CATALOG_FILTERS, name: '指数Index' })).toHaveLength(0)
  })
})

describe('the catalog country and importance filters', () => {
  it('keeps the country filter separate from the name box', () => {
    // `US` 只作为国家匹配，不会因为指标码里含 US 就命中。
    const target = row()
    expect(filterCatalogRows([target], { ...EMPTY_CATALOG_FILTERS, country: '美国' })).toHaveLength(1)
    expect(filterCatalogRows([target], { ...EMPTY_CATALOG_FILTERS, country: 'us' })).toHaveLength(1)
    expect(filterCatalogRows([target], { ...EMPTY_CATALOG_FILTERS, country: '德国' })).toHaveLength(0)
  })

  it('filters by importance on its own', () => {
    const rows = [row({ key: 'a', importance: 'high' }), row({ key: 'b', importance: 'low' })]
    expect(filterCatalogRows(rows, { ...EMPTY_CATALOG_FILTERS, importance: 'low' }).map((entry) => entry.key)).toEqual(['b'])
  })
})

describe('the catalog paging and order', () => {
  it('sorts by the latest release, newest first, and pushes rows without one to the end', () => {
    const rows = [id('a'), row({ key: 'no-date', lastRelease: undefined }), row({ key: 'newest', lastRelease: '2026-12-01' })]
    expect(sortCatalogRows(rows).map((entry) => entry.key)).toEqual(['newest', 'a', 'no-date'])
  })

  it('clamps a page past the end instead of showing an empty table', () => {
    // 筛选后行数变少、页码还停在第 5 页：夹回最后一页，而不是画一张空表（那不是「没有结果」）。
    const rows = Array.from({ length: 7 }, (_, index) => id(`k${index}`))
    const page = pageOf(rows, 5, 50)
    expect(page.page).toBe(1)
    expect(page.rows).toHaveLength(7)
    const second = pageOf(Array.from({ length: 120 }, (_, index) => id(`k${index}`)), 3, 50)
    expect(second.page).toBe(3)
    expect(second.rows).toHaveLength(20)
    expect(second.pageCount).toBe(3)
  })
})
