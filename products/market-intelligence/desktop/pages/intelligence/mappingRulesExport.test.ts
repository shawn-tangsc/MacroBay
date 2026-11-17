import { describe, expect, it } from 'vitest'

import { codeTableExportRows, exportFileName, sampleText, unmappedExportRows } from './mappingRulesExport'

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
  const codeColumns = { code: '码', country: '国家', name: '名称', tier: '分级', measure: '口径', official: '官网页', status: '状态', sourceIds: '源 id 数', dataVolume: '数据量' }
  const statusWords = { active: '生效', 'not-built': '不建', pending: '待补', retired: '已退役' } as const

  it('writes one row per code with the official page as a link or a word, never a blank', () => {
    const rows = codeTableExportRows([
      { code: 'US.CPI.NSA.YOY', kind: 'metric', names: { zhFull: 'CPI 年率', zhShort: 'CPI', enFull: 'Consumer Price Index (YoY)', enShort: 'CPI' },
        countryCode: 'US', countryName: '美国', tier: 1, measure: 'YOY', seasonality: 'NSA', status: 'active', reason: null,
        officialSource: { agency: 'BLS', url: 'https://www.bls.gov/x', pageKind: 'release', verifiedAt: '2026-11-17', basis: '发布目录' },
        sourceIdCount: 3, releaseRowCount: 12 },
      // 待补与不建：一个写词、一个写破折号，都不许留下空链接。
      { code: 'US.X.NONE.LEVEL', kind: 'metric', names: { zhFull: '某指标', zhShort: '某', enFull: 'Something', enShort: 'S' },
        countryCode: 'US', countryName: '美国', tier: null, measure: 'LEVEL', seasonality: 'NONE', status: 'pending',
        reason: 'official-source-todo',
        officialSource: { pending: true, reason: 'official-source-todo' }, sourceIdCount: 0, releaseRowCount: 0 },
      { code: 'US.Y.NONE.LEVEL', kind: 'metric', names: { zhFull: '不建指标', zhShort: '不建', enFull: 'Not built', enShort: 'NB' },
        countryCode: null, countryName: null, tier: null, measure: 'LEVEL', seasonality: 'NONE', status: 'not-built',
        reason: 'no-reader',
        officialSource: { pending: true, reason: 'official-source-todo' }, sourceIdCount: 0, releaseRowCount: 0 }
    ], { columns: codeColumns, status: statusWords, officialPending: '待核', officialNone: '—', unknownCountry: '未知国家' })
    expect(rows).toHaveLength(4)
    expect(rows[0]![0]).toBe('码')
    // 第 2 列是国家（在名称前面）：读口给 null 时写「未知国家」，不空着。
    expect(rows[1]![1]).toBe('美国')
    expect(rows[3]![1]).toBe('未知国家')
    // 分级与口径**各占一列**（3 / 4），官网页因此后移到第 5 列。
    expect(rows[1]![3]).toBe('1')
    expect(rows[1]![4]).toBe('YOY · NSA')
    expect(rows[1]![5]).toBe('https://www.bls.gov/x')
    expect(rows[2]![5]).toBe('待核')
    expect(rows[3]![5]).toBe('—')
    expect(rows[1]![6]).toBe('生效')
    // **源 id 数 0 写 0**：那是「没有源认得它」，不是空。
    expect(rows[3]![7]).toBe(0)
    // **数据量在最后**，与界面同一顺序；0 也照写 0。
    expect(rows[0]![8]).toBe('数据量')
    expect(rows[1]![8]).toBe(12)
    expect(rows[3]![8]).toBe(0)
  })

  it('exports the unmapped section with the bilingual sample in one cell', () => {
    const rows = unmappedExportRows([
      { sourceId: '214634', rowCount: 4, sampleLabel: '批发物价指数', sampleLabelEn: 'Wholesale prices' }
    ], { columns: { sourceId: 'id', rows: '行数', sample: '样本名' } })
    expect(rows[0]).toEqual(['id', '行数', '样本名'])
    expect(rows[1]![2]).toBe('批发物价指数 · Wholesale prices')
  })
})
