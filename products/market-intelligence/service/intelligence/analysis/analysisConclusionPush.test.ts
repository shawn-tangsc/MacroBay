import { describe, expect, it } from 'vitest'

import {
  analysisConclusionPushPolicy,
  analysisConclusionPushesPhone,
  buildAnalysisConclusionBody,
  cutAtSentenceEnd
} from './analysisConclusionPush'

/**
 * N12 判定层的三条判据（`02` 通知表）：**同向不推手机**、**配额上限**、**去重键不随 runId 变**。
 * 句子那条另有一组：中文 ≤40 / 英文 ≤90，超了截到句末、绝不截半句。
 */

const basePhone = {
  signalDirection: 'bearish' as const,
  conclusionDirection: 'bullish' as const,
  signalFactIds: ['mi-fact-flow'],
  citedFactIds: ['mi-fact-flow', 'mi-fact-price'],
  sentToday: { byBucket: 0, module: 0 }
}

describe('who gets woken up', () => {
  it('does not push the phone when the analysis agrees with the signal', () => {
    const decision = analysisConclusionPushesPhone({ ...basePhone, conclusionDirection: 'bearish', citedFactIds: ['mi-fact-flow'] })
    expect(decision).toMatchObject({ phone: false, centerOnly: true, reason: 'same-direction' })
  })

  it('pushes a threshold-triggered run that had no signal to compare against', () => {
    // 消息面达门槛的运行没有信号方向：没有"同向"可谈，达门槛本身就是新信息 → 该推手机。
    const decision = analysisConclusionPushesPhone({
      signalDriven: false, conclusionDirection: 'bearish', citedFactIds: ['mi-fact-flow'], sentToday: { byBucket: 0, module: 0 }
    })
    expect(decision).toMatchObject({ phone: true, centerOnly: false })
  })

  it('still keeps a no-signal run quiet when the quota is used up', () => {
    expect(analysisConclusionPushesPhone({
      signalDriven: false, conclusionDirection: 'bearish', citedFactIds: ['mi-fact-flow'], sentToday: { byBucket: 1, module: 1 }
    })).toMatchObject({ phone: false, centerOnly: true, reason: 'quota-trigger-key' })
  })

  it('pushes the phone when the conclusion goes the other way', () => {
    expect(analysisConclusionPushesPhone(basePhone)).toMatchObject({ phone: true, centerOnly: false })
  })

  it('pushes the phone when the conclusion cites something the signal did not carry', () => {
    const decision = analysisConclusionPushesPhone({ ...basePhone, conclusionDirection: 'bearish', citedFactIds: ['mi-fact-flow', 'mi-fact-etf'] })
    expect(decision).toMatchObject({ phone: true, centerOnly: false })
  })

  it('keeps the day and module caps: over the cap is centre only, never silence', () => {
    // 同一触发键每天 1 条：第二条只进中心（不是不发）。
    expect(analysisConclusionPushesPhone({ ...basePhone, sentToday: { byBucket: 1, module: 1 } }))
      .toMatchObject({ phone: false, centerOnly: true, reason: 'quota-trigger-key' })
    // 模块每天 4 条：第 5 条起只进中心。
    expect(analysisConclusionPushesPhone({ ...basePhone, sentToday: { byBucket: 0, module: 4 } }))
      .toMatchObject({ phone: false, centerOnly: true, reason: 'quota-module' })
    expect(analysisConclusionPushesPhone({ ...basePhone, sentToday: { byBucket: 0, module: 3 } }))
      .toMatchObject({ phone: true })
  })
})

describe('the dedupe key ignores the run id', () => {
  it('is built from the bucket and the cutoff, and the template names no run', () => {
    // 桶 = 原因码 + 事件：不同事件各算一次，同一条事件重复触发仍被合并。
    // 同一份证据重跑会得到新 runId；键里带它就等于给读者发两条同样的结论。
    expect(analysisConclusionPushPolicy.dedupeKeyTemplate).toBe('analysis:{bucket}:{cutoff}')
    expect(analysisConclusionPushPolicy.dedupeKeyTemplate).not.toContain('run')
    expect(analysisConclusionPushPolicy.perBucketDailyLimit).toBe(1)
    expect(analysisConclusionPushPolicy.moduleDailyLimit).toBe(4)
  })
})

describe('the sentence', () => {
  it('cuts at a sentence end, never in the middle of a sentence', () => {
    const long = '比特币在消息后先跌后涨。资金面没有跟着恶化，说明抛压有限。后半句很长，长到必须被切掉。'
    const cut = cutAtSentenceEnd(long, 20)
    expect(cut.text).toBe('比特币在消息后先跌后涨。')
    expect(cut.overLimit).toBe(true)
  })

  it('returns the whole sentence rather than half of it when no sentence end fits', () => {
    const noEnd = '这句话没有任何句末标点所以只能整句返回而不会被截成半句'
    const cut = cutAtSentenceEnd(noEnd, 10)
    expect(cut.text).toBe(noEnd)
    expect(cut.overLimit).toBe(true)
  })

  it('keeps the Chinese body within 40 characters and adds the evidence count only when pushing', () => {
    const input = { summary: '抛压来自被动减仓，不是趋势反转。', reason: 'ETF 流出与价格同步，属于仓位调整；后面还有半句不该进来。', citedCount: 3 }
    const pushed = buildAnalysisConclusionBody({ ...input, withContext: true })
    expect(pushed.language).toBe('zh-CN')
    expect(pushed.text.startsWith('抛压来自被动减仓，不是趋势反转。')).toBe(true)
    expect(pushed.text).toContain('证据 3 条')
    // 只取理由的半句：分号之后的内容不许进正文。
    expect(pushed.text).not.toContain('后面还有半句')
    expect(pushed.text.replace(' · 证据 3 条', '').length).toBeLessThanOrEqual(40)

    const centerOnly = buildAnalysisConclusionBody({ ...input, withContext: false })
    expect(centerOnly.text).not.toContain('证据')
  })

  it('keeps the English body within 90 characters', () => {
    const body = buildAnalysisConclusionBody({
      summary: 'The move is positioning, not a reversal. Flows and price fell together, which points to de-risking rather than a new trend.',
      reason: 'Flows fell alongside price, so this is a position adjustment.',
      citedCount: 2,
      withContext: true
    })
    expect(body.language).toBe('en-US')
    expect(body.text.replace(' · 2 evidence refs', '').length).toBeLessThanOrEqual(90)
  })
})

describe('an unreadable signal widens nothing', () => {
  it('does not treat "no known signal facts" as new information', () => {
    // 空数组会让每一条引用都像新事实 → 每次都能叫醒手机；读不出来必须按"没有新信息"算。
    const decision = analysisConclusionPushesPhone({
      signalDirection: 'bearish',
      conclusionDirection: 'bearish',
      citedFactIds: ['mi-fact-flow', 'mi-fact-price'],
      sentToday: { byBucket: 0, module: 0 }
    })
    expect(decision).toMatchObject({ phone: false, centerOnly: true, reason: 'same-direction' })
  })

  it('keeps a signal run centre-only when its rule has no registered direction', () => {
    // 信号唤起、但规则方向没登记：没有证据说"反了"，不叫醒（这是信号那一档的旧口径）。
    const decision = analysisConclusionPushesPhone({
      signalDriven: true,
      conclusionDirection: 'bullish',
      citedFactIds: ['mi-fact-flow'],
      sentToday: { byBucket: 0, module: 0 }
    })
    expect(decision).toMatchObject({ phone: false, centerOnly: true })
  })
})
