import { describe, expect, it } from 'vitest'

import { exportFileName, mappedExportRows, sampleText, unmappedExportRows } from './mappingRulesExport'

/** 导出两件事的判据：文件名净化、导出的是**筛选全量**而不是当前页。 */
const columns = { sourceId: 'id', metricKey: '码', name: '名称', tier: '分级', periodRule: '期次', basis: '依据', official: '官方', rows: '行数' }
const tiers = { '1': '一级', '2': '二级', '3': '三级', other: '未分级' }

describe('exportFileName', () => {
  it('strips path separators and control characters, then appends the date', () => {
    // 筛选词是读者输入的自由文本：`/` 与 `:` 直接拼进去会保存失败或变成奇怪的路径片段。
    expect(exportFileName('映射规则-CPI/年率:2026', new Date('2026-11-17T00:00:00Z')))
      .toBe('映射规则-CPI年率2026-2026-11-17.xlsx')
    expect(exportFileName('  ', new Date('2026-11-17T00:00:00Z'))).toBe('export-2026-11-17.xlsx')
  })
})

describe('sampleText', () => {
  it('joins both languages and never leaves a dangling separator', () => {
    expect(sampleText({ sampleLabel: '纽约联储制造业指数', sampleLabelEn: 'New York Fed' })).toBe('纽约联储制造业指数 · New York Fed')
    expect(sampleText({ sampleLabel: '只有中文', sampleLabelEn: null })).toBe('只有中文')
    expect(sampleText({ sampleLabel: null, sampleLabelEn: 'english only' })).toBe('english only')
  })
})

describe('the exported rows', () => {
  it('carries a header plus every filtered row, with tier and row count readable', () => {
    const rows = mappedExportRows([
      { sourceId: '214790', metricKey: 'US.CPI.NSA.YOY', periodRule: 'month', basis: 'BLS · 发布页',
        officialUrl: 'https://www.bls.gov/x', names: { zh: 'CPI 年率', en: 'CPI YoY' }, tier: 1, rowCount: 12 },
      { sourceId: '10113', metricKey: 'US.MICHIGAN.NONE.LEVEL', periodRule: 'month', basis: null,
        officialUrl: null, names: null, tier: null, rowCount: 0 }
    ], { columns, tiers })
    expect(rows).toHaveLength(3)
    expect(rows[0]![0]).toBe('id')
    // `tier: null` → 「未分级」；`rowCount: 0` → 0（空着会被读成「没有这条规则」）。
    expect(rows[2]![3]).toBe('未分级')
    expect(rows[2]![7]).toBe(0)
    // 没有名表条目时名称格空着，不拿指标码拼假名。
    expect(rows[2]![2]).toBe('')
  })

  it('exports the unmapped section with the bilingual sample in one cell', () => {
    const rows = unmappedExportRows([
      { sourceId: '214634', rowCount: 4, sampleLabel: '批发物价指数', sampleLabelEn: 'Wholesale prices' }
    ], { columns: { sourceId: 'id', rows: '行数', sample: '样本名' } })
    expect(rows[0]).toEqual(['id', '行数', '样本名'])
    expect(rows[1]![2]).toBe('批发物价指数 · Wholesale prices')
  })
})
