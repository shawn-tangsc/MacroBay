import { describe, expect, it } from 'vitest'

import { conclusionBlocksFromStructured, parseConclusionBlocks, conclusionSummaryText, conclusionWithoutDirection, readConclusion, readConclusionDirection } from './analysisConclusionBlocks'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

describe('conclusion block parsing', () => {
  it('keeps a readable sentence whole instead of inventing labels', () => {
    const blocks = parseConclusionBlocks('已公布的非农弱于前值，但缺少共识值，方向不清晰。')
    expect(blocks).toEqual([{ kind: 'text', text: '已公布的非农弱于前值，但缺少共识值，方向不清晰。' }])
  })

  it('lifts the fields the model labels into their own blocks', () => {
    const blocks = parseConclusionBlocks(
      '就业数据走弱。因果链：ETF 净流出（起因）→ 现货需求收缩（中间变量）→ 因此判定偏空。数据缺口：cross-asset 缺失，无法验证美元与美股同向性。'
    )

    expect(blocks).toEqual([
      { kind: 'text', text: '就业数据走弱。' },
      { kind: 'causal-chain', text: 'ETF 净流出（起因）→ 现货需求收缩（中间变量）→ 因此判定偏空。' },
      { kind: 'data-gap', text: 'cross-asset 缺失，无法验证美元与美股同向性。' }
    ])
  })

  it('recognises the other labels the prompt asks for', () => {
    const kinds = parseConclusionBlocks(
      '本次变化：BTC 流出转为净流出。宏观侧：非农弱于前值。证据强弱：资金流证据最新。成立条件：流出延续 1-2 个交易日。'
    ).map(block => block.kind)
    expect(kinds).toEqual(['change', 'macro', 'evidence', 'condition'])
  })

  it('strips the direction marker so it is not rendered twice', () => {
    expect(parseConclusionBlocks('方向：偏空：ETF 由净申购转为净赎回。')).toEqual([
      { kind: 'text', text: 'ETF 由净申购转为净赎回。' }
    ])
  })

  it('returns nothing for an empty conclusion instead of an empty block', () => {
    expect(parseConclusionBlocks('   ')).toEqual([])
  })
})

/** A real published conclusion, kept verbatim: it exercises every label at once. */
const publishedConclusion = "方向：偏空：本次变化：BTC ETF 净流入由 10-06 的 +1.188 亿美元转为 10-07 的 -4.849 亿美元；ETH ETF 由 -2.019 亿美元收窄至 -1.609 亿美元但仍为净流出；稳定币总量 1 日变动由约 -3.947 亿美元扩大至 -4.068 亿美元，而 7 日/30 日仍为正（+1.252 亿/+1.642 亿美元）；BTC 资金费率由 -0.000992% 微降至 -0.001185%，ETH 由 -0.003319% 回升至 +0.000509%；恐慌贪婪指数由 71 降至 64。因果链：现货 ETF 由净申购转为大额净赎回（起因）→ 边际现货需求与稳定币增量流动性同时收缩、杠杆资金在零费率附近不再提供承接（中间变量：资金流与杠杆）→ 对该资产的作用方向偏下行 → 因此本判断成立的条件是 ETF 净流出与稳定币 1 日收缩在后续 1-2 个交易日延续，且无跨资产风险偏好回升对冲。宏观侧：9 月非农 +29K 远低于前值 +133K、失业率 4.2% 高于前值 4.1%、时薪 0.1% 低于前值 0.3%，属增长走弱信号，本可经美元与实际利率下行利多风险资产，但 consensus 缺失、且无美元与股指证据，无法确认预期差方向，故不作为主导证据。证据强弱：当日资金流证据（BTC/ETH 净流出、稳定币 1 日转负）时间最近、方向一致，强于 7/30 日稳定币仍为正与前期 ETF 申购的滞后多头证据。数据缺口：cross-asset 域缺失，无法验证美元与美股同向性；无 BTC/ETH 价格与成交量证据，故不评估反应幅度，整体置信度中等。"

describe('a published conclusion', () => {
  it('splits into the labelled parts without losing any text', () => {
    const blocks = parseConclusionBlocks(publishedConclusion)
    expect(blocks.map(block => block.kind)).toEqual(['change', 'causal-chain', 'macro', 'evidence', 'data-gap'])
    for (const block of blocks) expect(block.text.length).toBeGreaterThan(10)
    // The direction badge already shows `偏空`, so the body must not repeat it.
    expect(blocks.some(block => block.text.startsWith('偏空'))).toBe(false)
    // Every sentence of the source survives somewhere in a block.
    const joined = blocks.map(block => block.text).join('')
    for (const marker of ['10-07 的 -4.849 亿美元', '中间变量：资金流与杠杆', '证据强弱', '整体置信度中等']) {
      expect(joined).toContain(marker.replace('证据强弱', ''))
    }
  })
})

it('keeps only the conclusion for a list row, cutting at the first labelled part', () => {
  const body = '现货买盘停滞与稳定币存量收缩同时出现，短期下行风险大于上行。本次变化：BTC ETF 净流入由 -2.02 亿美元变为 0 美元。因果链：起因事件为美国 9 月非农就业。'
  const summary = conclusionSummaryText(body)
  expect(summary).toBe('现货买盘停滞与稳定币存量收缩同时出现，短期下行风险大于上行。')
  expect(summary).not.toContain('本次变化')
  expect(summary).not.toContain('因果链')
})

it('returns a conclusion without labels unchanged', () => {
  expect(conclusionSummaryText('  暂不判断。  ')).toBe('暂不判断。')
  expect(conclusionSummaryText('')).toBe('')
})

it('treats a body that starts with a label as having no conclusion', () => {
  // The hole that let a label-only output through: a label at index 0 was treated as "nothing to
  // cut", so the whole label list was shown as if it were the conclusion.
  expect(conclusionWithoutDirection('本次变化：1 日变化由-4.07 亿变为-4.39 亿。')).toBe('')
  expect(conclusionWithoutDirection('方向：偏空：本次变化：净流入转为 -6540 万美元。')).toBe('')
})

describe('direction keys and legacy terms', () => {
  it('maps either a key or a legacy Chinese term to the reader language', () => {
    expect(localizedDirectionTerm('bearish', 'en-US')).toBe('Bearish')
    expect(localizedDirectionTerm('bearish', 'zh-CN')).toBe('偏空')
    expect(localizedDirectionTerm('偏空', 'en-US')).toBe('Bearish')
  })

  it('keeps reading the legacy Chinese marker for history that predates the structured contract', () => {
    expect(readConclusionDirection('方向：偏空：资金面转弱。')).toBe('bearish')
    expect(conclusionWithoutDirection('方向：偏空：资金面转弱。')).toBe('资金面转弱。')
  })
})

const structuredConclusion = {
  direction: 'bearish' as const,
  summary: '收益率上行压制风险资产。',
  change: 'ETF 净流出 6,540 万美元。',
  causalChain: '通胀高于前值 → 实际利率上升 → 风险资产承压。',
  conditions: ['通胀粘性持续。', '美元不回落。'],
  macro: '美债收益率上行。',
  evidenceStrength: '反向证据较弱。',
  dataGaps: ['缺少市场预期值。']
}

describe('structured conclusion blocks', () => {
  it('maps fields to the same block kinds the labelled paragraph produced', () => {
    expect(conclusionBlocksFromStructured(structuredConclusion)).toEqual([
      { kind: 'text', text: '收益率上行压制风险资产。' },
      { kind: 'change', text: 'ETF 净流出 6,540 万美元。' },
      { kind: 'causal-chain', text: '通胀高于前值 → 实际利率上升 → 风险资产承压。' },
      { kind: 'condition', text: '通胀粘性持续。' },
      { kind: 'condition', text: '美元不回落。' },
      { kind: 'macro', text: '美债收益率上行。' },
      { kind: 'evidence', text: '反向证据较弱。' },
      { kind: 'data-gap', text: '缺少市场预期值。' }
    ])
  })

  it('omits empty optional fields instead of rendering empty rows', () => {
    const kinds = conclusionBlocksFromStructured({ ...structuredConclusion, macro: null, evidenceStrength: null, conditions: [], dataGaps: [] })
      .map(block => block.kind)
    expect(kinds).toEqual(['text', 'change', 'causal-chain'])
  })
})

describe('reading a conclusion of either contract generation', () => {
  it('reads the structured generation without needing the legacy field', () => {
    const reading = readConclusion({ conclusion: structuredConclusion })
    expect(reading.direction).toBe('bearish')
    expect(reading.verdict).toBe('收益率上行压制风险资产。')
    expect(reading.blocks[0]).toEqual({ kind: 'text', text: '收益率上行压制风险资产。' })
  })

  it('still reads a legacy labelled paragraph when no structured conclusion was written', () => {
    const reading = readConclusion({ eventAssessment: '方向：偏空：资金面转弱。本次变化：净流入转为流出。' })
    expect(reading.direction).toBe('bearish')
    expect(reading.verdict).toBe('资金面转弱。')
    expect(reading.blocks.map(block => block.kind)).toEqual(['text', 'change'])
  })
})
