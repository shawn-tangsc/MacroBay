import { describe, expect, it } from 'vitest'

import { codeTableExportRows, eventExportRows, exportFileName, sampleText, unmappedExportRows } from './mappingRulesExport'

/**
 * 导出的判据（用户 2026-11-18：「导出的时候，几个新字段怎么没一起导出？」）：
 * 1. **界面有的列，导出必须也有**，用同一批文案与同一套格式化；
 * 2. 文件名净化；
 * 3. 导出的是**全量**，不看筛选与页码（那一层在弹框的调用点上）；
 * 4. 官网页三态：有页写「机构 · 地址」，待补写「待核」，不建/退役写 `—`，**绝不留空**。
 */
const tiers = { '1': '一级', '2': '二级', '3': '三级', other: '未分级' }
const tierStars = { '1': '★★★', '2': '★★', '3': '★', other: '—' }

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
  const codeColumns = { code: '码', country: '国家', tier: '分级', measure: '口径', official: '官网页', status: '状态', sourceIds: '源 id 数', dataVolume: '数据量' }
  const statusWords = { active: '生效', 'not-built': '不建', pending: '待补', retired: '已退役' } as const
  const codeText = {
    columns: codeColumns, status: statusWords, officialPending: '待核', officialNone: '—', unknownCountry: '—',
    nameZh: '中文名', nameEn: '英文名', tierStars, tierNames: tiers
  }

  it('writes one row per code with the split names, star tier and agency+url', () => {
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
    ], codeText)
    expect(rows).toHaveLength(4)
    // 列头与界面同一批文案；名称拆成中文名 / 英文名两列（导出可以更细，不能更少）。
    expect(rows[0]).toEqual(['码', '国家', '中文名', '英文名', '分级', '口径', '官网页', '状态', '源 id 数', '数据量'])
    expect(rows[1]![1]).toBe('美国')
    expect(rows[3]![1]).toBe('—')
    expect(rows[1]![2]).toBe('CPI 年率')
    expect(rows[1]![3]).toBe('Consumer Price Index (YoY)')
    // 分级 = 星级 + 中文档名：单看星星没有含义，单看文字又和列里的写法不一致。
    expect(rows[1]![4]).toBe('★★★ 一级')
    expect(rows[3]![4]).toBe('— 未分级')
    expect(rows[1]![5]).toBe('YOY · NSA')
    // 官网页写「机构 · 地址」；待补写词；不建写破折号。
    expect(rows[1]![6]).toBe('BLS · https://www.bls.gov/x')
    expect(rows[2]![6]).toBe('待核')
    expect(rows[3]![6]).toBe('—')
    expect(rows[1]![7]).toBe('生效')
    expect(rows[3]![8]).toBe(0)
    expect(rows[1]![9]).toBe(12)
  })

  it('exports the unmapped rows with reason, first-seen, sources and the raw title', () => {
    const rows = unmappedExportRows([
      { sourceId: '214634', rowCount: 4, firstSeenAt: '2026-11-16T00:00:00.000Z', providerIds: ['0xrouter', 'narwhal'],
        reason: 'no-code', sampleLabel: '批发物价指数', sampleLabelEn: 'Wholesale prices',
        countryCode: null, countryName: null }
    ], {
      columns: { sourceId: '源内 id', country: '国家', reason: '原因', firstSeen: '首次出现', providers: '来源', sample: '标题原文', rows: '行数' },
      reasons: { 'no-code': '没有对应的码', 'period-unresolved': '源没给统计期' },
      reasonUnknown: '无法确认',
      firstSeenUnknown: '无法确认',
      formatTime: (instant) => `T(${instant})`
    })
    expect(rows[0]).toEqual(['源内 id', '国家', '原因', '首次出现', '来源', '标题原文', '行数'])
    // 国家在源内 id 之后：有国名写中文名，取不到写 `—`（不写「未知国家」）。
    expect(rows[1]![1]).toBe('—')
    // 原因写白话，不印枚举；时间走调用方给的同一套格式化，不在这里另拼。
    expect(rows[1]![2]).toBe('没有对应的码')
    expect(rows[1]![3]).toBe('T(2026-11-16T00:00:00.000Z)')
    expect(rows[1]![4]).toBe('0xrouter · narwhal')
    expect(rows[1]![5]).toBe('批发物价指数 · Wholesale prices')
    expect(rows[1]![6]).toBe(4)
  })

  it('writes a word, not a blank, when the first-seen time is missing', () => {
    const rows = unmappedExportRows([
      { sourceId: '999999', rowCount: 1, firstSeenAt: null, providerIds: ['0xrouter'],
        reason: 'no-standard-row', sampleLabel: '残行', sampleLabelEn: null,
        countryCode: 'JP', countryName: '日本' }
    ], {
      columns: { sourceId: '源内 id', country: '国家', reason: '原因', firstSeen: '首次出现', providers: '来源', sample: '标题原文', rows: '行数' },
      reasons: { 'no-standard-row': '没进标准表' }, reasonUnknown: '无法确认', firstSeenUnknown: '无法确认',
      formatTime: (instant) => instant
    })
    expect(rows[1]![3]).toBe('无法确认')
  })

  it('exports events with the same five columns as the tab', () => {
    const rows = eventExportRows([
      { key: 'k1', eventType: 'central-bank-activity', scheduledDate: '2026-10-29', scheduledAt: '2026-10-29T18:00:00.000Z',
        countryCode: 'US', countryName: '美国', title: 'FOMC 会议', titleEn: 'FOMC meeting', sourceProviderId: '0xrouter',
        status: 'published' },
      { key: 'k2', eventType: 'financial-event', scheduledDate: '2026-10-14', scheduledAt: null,
        countryCode: null, countryName: null, title: null, titleEn: null, sourceProviderId: '0xrouter', status: 'unknown' }
    ], {
      columns: { time: '时间', country: '国家', title: '标题', provider: '来源', status: '状态' },
      statusLabels: { published: '已发布' }, statusUnknown: '无法确认', titleMissing: '源未提供标题'
    }, (row) => row.scheduledAt ?? row.scheduledDate)
    expect(rows[0]).toEqual(['时间', '国家', '标题', '来源', '状态'])
    expect(rows[1]![1]).toBe('美国')
    expect(rows[1]![2]).toBe('FOMC 会议 · FOMC meeting')
    expect(rows[1]![3]).toBe('0xrouter')
    expect(rows[1]![4]).toBe('已发布')
    // 拿不到的写「无法确认 / 源未提供标题」，不空着、不编。
    expect(rows[2]![1]).toBe('—')
    expect(rows[2]![2]).toBe('源未提供标题')
    expect(rows[2]![4]).toBe('无法确认')
  })
})