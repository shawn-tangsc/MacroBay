import { describe, expect, it, vi } from 'vitest'

import { repairPromptFor } from './dailyBriefingPrompt'

import type { BriefingNextItem, DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { DailyBriefTurnAbortedError, maximumRepairRounds, runDailyBriefAgentTurn } from './dailyBriefAgentTurn'

const CJK = /[\u4e00-\u9fff]/

const document = (locale: DailyBriefingLocale): DailyBriefingDocument => ({
  schemaVersion: 6,
  policyVersion: 'daily-briefing.v17',
  edition: {
    date: '2026-10-30', locale, generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: 'Stablecoins keep contracting.', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1', title: 'Stablecoin supply keeps shrinking', sourceName: 'CoinDesk RSS',
      publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    policyPath: { state: 'available', meetingDate: '2026-12-09', outcome: 'hike-25', probability: 76, observedAt: '2026-10-30T02:10:00.000Z' },
    leverage: { state: 'available', btc: { openInterestUsd: 1_200_000_000, change24hPct: -1.2 }, eth: { openInterestUsd: 800_000_000, change24hPct: 0.4 } },
    funds: [{
      id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin',
      importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available',
      value: { number: 253_033_903_673.4, format: 'usd' }, change: null, window: '1d', observedAt: '2026-10-30T00:12:00.000Z'
    }],
    sentiment: {
      fearGreed: null,
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.', conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
  },
  next: {
    focus: {
      eventKey: 'US.FOMC', title: 'FOMC decision', at: '2026-11-02T18:00:00.000Z',
      importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: 'United States', consensus: '4.25%'
    },
    items: []
  },
  citations: [],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' }
})

const relevantNext = (): { fomc: BriefingNextItem; pmi: BriefingNextItem } => ({
  fomc: {
    eventKey: 'US.FOMC', title: 'FOMC decision', at: '2026-11-02T18:00:00.000Z',
    importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: 'United States', consensus: '4.25%',
    relevance: { score: 100, role: 'rate-policy', reasonCode: 'policy-rate-path' }
  },
  pmi: {
    eventKey: 'CN.NBS_PMI', title: 'China NBS Manufacturing PMI', at: '2026-10-31T01:00:00.000Z',
    importance: 'high', category: 'economic-indicator', countryCode: 'CN', countryName: 'China',
    relevance: { score: 45, role: 'asia-risk', reasonCode: 'asia-growth-spillover' }
  }
})

const withNextCandidates = (): DailyBriefingDocument => {
  const base = document('en-US')
  const { fomc, pmi } = relevantNext()
  return { ...base, next: { focus: fomc, items: [], candidates: [fomc, pmi] } }
}

const withNoConsensusMacro = (): DailyBriefingDocument => {
  const base = withNextCandidates()
  const ppi = {
    eventKey: 'US.PPI', title: 'PPI', scheduledAt: '2026-10-29T13:30:00.000Z',
    importance: 'high' as const, actual: '0.4%', previous: '0.2%',
    surprise: { direction: 'consensus-unavailable' as const }
  }
  return { ...base, news: { ...base.news, macro: [...base.news.macro, ppi], macroCandidates: [...base.news.macro, ppi] } }
}

const withManyMacro = (): DailyBriefingDocument => {
  const base = withNextCandidates()
  const keys = ['US.CPI', 'US.PPI', 'US.PCE', 'US.GDP', 'US.RETAIL', 'US.CLAIMS']
  const macro = keys.map((eventKey, index) => ({
    eventKey, title: eventKey, scheduledAt: `2026-10-29T${String(10 + index).padStart(2, '0')}:30:00.000Z`,
    importance: 'high' as const, actual: `${index + 1}.0%`, previous: `${index}.0%`, consensus: `${index + 0.5}%`,
    surprise: { direction: 'beat' as const, value: 0.5, unit: 'pp' as const }
  }))
  return { ...base, news: { ...base.news, macro, macroCandidates: macro } }
}

const editorial = (focusKey: string, focusWhy: string) => ({
  lede: 'Stablecoin contraction keeps the read defensive.',
  ledePattern: 'structure',
  items: [
    { factId: 'news:n1', why: 'Stablecoin supply keeps shrinking and pulls bids away.' },
    { factId: 'macro:US.CPI', why: 'The CPI beat keeps the discount rate higher for longer.' }
  ],
  hidden: [],
  importance: [],
  nextFocus: {
    eventKey: focusKey,
    why: focusWhy,
    watch: [
      { condition: 'Higher than expected', implication: 'Yields rise and BTC/ETH lose bid support.' },
      { condition: 'Lower than expected', implication: 'Rate-cut odds improve and BTC/ETH catch a bid.' }
    ]
  }
})

function scriptedRunner(selection: unknown, written: unknown) {
  const starts: { displayText?: string; prompt?: string; context?: { label: string } }[] = []
  const continues: string[] = []
  let rounds = 0
  return {
    starts,
    continues,
    runner: {
      start: vi.fn(async (input: { displayText?: string; prompt?: string; context?: { label: string } }) => {
        starts.push(input)
        return { sessionId: 's1', created: true, assistantText: JSON.stringify(selection), toolInvocations: [] }
      }),
      continue: vi.fn(async (_sessionId: string, text: string) => {
        continues.push(text)
        rounds += 1
        return { assistantText: rounds === 1 ? JSON.stringify(written) : '{}', toolInvocations: [] }
      }),
      finish: vi.fn(async () => undefined)
    }
  }
}

function fakeRunner(selection: unknown = { stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [], requests: [{ factId: 'macro:US.CPI', fields: ['actual', 'translation'] }] }) {
  const starts: { displayText?: string; prompt?: string; context?: { label: string } }[] = []
  const continues: string[] = []
  return {
    starts,
    continues,
    runner: {
      start: vi.fn(async (input: { displayText?: string; prompt?: string; context?: { label: string } }) => {
        starts.push(input)
        return {
          sessionId: 's1',
          created: true,
          assistantText: JSON.stringify(selection),
          toolInvocations: []
        }
      }),
      continue: vi.fn(async (_sessionId: string, text: string) => {
        continues.push(text)
        return { assistantText: '{}', toolInvocations: [] }
      }),
      finish: vi.fn(async () => undefined)
    }
  }
}

describe('daily brief agent turn copy', () => {
  it('does not open another agent round once the generation is aborted', async () => {
    const { continues, runner } = fakeRunner()
    const controller = new AbortController()
    const start = runner.start
    runner.start = vi.fn(async (input: { displayText?: string; context?: { label: string } }) => {
      const result = await start(input)
      controller.abort()
      return result
    })

    await expect(runDailyBriefAgentTurn({ runner, document: document('en-US'), locale: 'en-US', signal: controller.signal }))
      .rejects.toBeInstanceOf(DailyBriefTurnAbortedError)
    expect(continues).toHaveLength(0)
    expect(runner.finish).not.toHaveBeenCalled()
  })

  it('opens the writing session under the edition\'s own period, so two periods cannot overwrite one session', async () => {
    const started: Array<{ periodId?: string }> = []
    const runner = {
      start: vi.fn(async (input: { periodId?: string }) => {
        started.push(input)
        return {
          sessionId: 's1', created: true, toolInvocations: [],
          assistantText: JSON.stringify({ stage: 'select', news: ['news:n1'], macro: [], next: [], requests: [] })
        }
      }),
      continue: vi.fn(async () => ({ assistantText: '{}', toolInvocations: [] })),
      finish: vi.fn(async () => undefined)
    }
    const period = (periodId: string) => {
      const base = document('en-US')
      return { ...base, edition: { ...base.edition, periodId } } as typeof base
    }

    await runDailyBriefAgentTurn({ runner, document: period('period_a'), locale: 'en-US' })
    await runDailyBriefAgentTurn({ runner, document: period('period_b'), locale: 'en-US' })

    // The session key carries the period; a shared `default` key would have the second run write
    // over the first period's conversation.
    expect(started.map((input) => input.periodId)).toEqual(['period_a', 'period_b'])
  })

  it('writes the first task, the fact card and the field answers in English for en-US', async () => {
    const { starts, continues, runner } = fakeRunner()
    await runDailyBriefAgentTurn({ runner, document: document('en-US'), locale: 'en-US' })
    expect(starts[0]?.context?.label).toBe('Daily brief facts')
    expect(starts[0]?.displayText).toContain('Task 1/2')
    expect(starts[0]?.displayText).toContain('Macro candidates 1')
    expect(starts[0]?.displayText).not.toMatch(CJK)
    const field = continues.find((text) => text.startsWith('FIELD RESPONSE'))
    expect(field).toContain('actual=3.4%')
    expect(field).toContain('translation=not collected')
    expect(field).not.toMatch(CJK)
  })

  it('shows the data facts in the selection pass and carries a data include into the writing pass', async () => {
    const { starts, continues, runner } = fakeRunner({
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [], data: ['data:leverage']
    })
    await runDailyBriefAgentTurn({ runner, document: document('en-US'), locale: 'en-US' })
    const selection = starts[0]?.prompt ?? ''
    expect(selection).toContain('data:leverage')
    expect(selection).toContain('"materiality"')
    const writing = continues.find((text) => text.includes('Write this exact JSON shape')) ?? ''
    expect(writing).toContain('"factId": "data:leverage"')
    expect(writing).toContain('"visibility": "shown"')
    expect(writing).toContain('hiddenData')
  })

  it('keeps the Chinese session copy for zh-CN', async () => {
    const { starts, continues, runner } = fakeRunner()
    await runDailyBriefAgentTurn({ runner, document: document('zh-CN'), locale: 'zh-CN' })
    expect(starts[0]?.context?.label).toBe('日报输入事实')
    expect(starts[0]?.displayText).toContain('任务 1/2')
    expect(starts[0]?.displayText).toContain('宏观候选 1')
    const field = continues.find((text) => text.startsWith('FIELD RESPONSE'))
    expect(field).toContain('actual=3.4%')
    expect(field).toContain('translation=未收录')
  })

  it('lets the editor move the focus to a lower-ranked event with a BTC/ETH transmission', async () => {
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [],
      focus: 'CN.NBS_PMI',
      focusWhy: 'China growth surprises transmit to BTC/ETH through Asia risk appetite and the dollar.'
    }
    const { continues, runner } = scriptedRunner(selection, editorial(
      'CN.NBS_PMI',
      'China growth surprises transmit to BTC/ETH through Asia risk appetite and the dollar.'
    ))

    const result = await runDailyBriefAgentTurn({ runner, document: withNextCandidates(), locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    expect(result.document.next.focus?.eventKey).toBe('CN.NBS_PMI')
    expect(result.document.next.focus?.why).toContain('BTC/ETH')
    const writing = continues.find((text) => text.includes('Write this exact JSON shape')) ?? ''
    expect(writing).toContain('"eventKey": "CN.NBS_PMI"')
    expect(writing).toContain('"focus": true')
  })

  it('falls back to the relevance leader when the chosen focus has no BTC/ETH transmission', async () => {
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [],
      focus: 'CN.NBS_PMI',
      focusWhy: 'It is the first event on the calendar.'
    }
    const { continues, runner } = scriptedRunner(selection, editorial(
      'US.FOMC',
      'The policy path sets the discount rate on BTC and ETH.'
    ))

    const result = await runDailyBriefAgentTurn({ runner, document: withNextCandidates(), locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    expect(result.document.next.focus?.eventKey).toBe('US.FOMC')
    expect(result.document.next.focus?.why).toContain('BTC and ETH')
    const writing = continues.find((text) => text.includes('Write this exact JSON shape')) ?? ''
    expect(writing).toContain('"eventKey": "US.FOMC"')
  })

  it('ignores an unknown focus key instead of failing the edition', async () => {
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [],
      focus: 'XX.UNKNOWN',
      focusWhy: 'It changes the dollar and BTC/ETH liquidity.'
    }
    const { runner } = scriptedRunner(selection, editorial(
      'US.FOMC',
      'The policy path sets the discount rate on BTC and ETH.'
    ))

    const result = await runDailyBriefAgentTurn({ runner, document: withNextCandidates(), locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    expect(result.document.next.focus?.eventKey).toBe('US.FOMC')
  })

  it('shows a no-consensus event the editor selected and explained with actual vs previous', async () => {
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI', 'macro:US.PPI'], next: [],
      focus: 'US.FOMC',
      focusWhy: 'The policy path sets the discount rate for BTC and ETH.'
    }
    const written = {
      ...editorial('US.FOMC', 'The policy path sets the discount rate for BTC and ETH.'),
      items: [
        { factId: 'news:n1', why: 'Stablecoin supply keeps shrinking and pulls bids away.' },
        { factId: 'macro:US.CPI', why: 'The CPI beat keeps the discount rate higher for longer.' },
        { factId: 'macro:US.PPI', why: 'PPI printed 0.4% against 0.2% previously, so pipeline pressure is still firm.' }
      ]
    }
    const { runner } = scriptedRunner(selection, written)

    const result = await runDailyBriefAgentTurn({ runner, document: withNoConsensusMacro(), locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    const ppi = result.document.news.macro.find((item) => item.eventKey === 'US.PPI')
    expect(ppi).toMatchObject({ importance: 'high', actual: '0.4%', previous: '0.2%', visibility: 'shown' })
    expect(ppi?.why).toContain('0.4%')
    expect(ppi?.consensus).toBeUndefined()
    expect(result.document.provenance.selectionAudit?.shown).toContain('macro:US.PPI')
  })

  it('leaves a no-consensus event hidden when the editor does not select it', async () => {
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [],
      hidden: [{ factId: 'macro:US.PPI', reason: 'Low crypto relevance: the move is already in the price.' }],
      focus: 'US.FOMC',
      focusWhy: 'The policy path sets the discount rate for BTC and ETH.'
    }
    const { runner } = scriptedRunner(selection, editorial('US.FOMC', 'The policy path sets the discount rate for BTC and ETH.'))

    const result = await runDailyBriefAgentTurn({ runner, document: withNoConsensusMacro(), locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    expect(result.document.news.macro.find((item) => item.eventKey === 'US.PPI')).toBeUndefined()
    expect(result.document.provenance.selectionAudit?.hidden).toContainEqual({
      factId: 'macro:US.PPI', reason: 'Low crypto relevance: the move is already in the price.'
    })
  })

  it('leaves a no-consensus event hidden when the editor hides it for low relevance', async () => {
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI', 'macro:US.PPI'], next: [],
      focus: 'US.FOMC',
      focusWhy: 'The policy path sets the discount rate for BTC and ETH.'
    }
    const written = {
      ...editorial('US.FOMC', 'The policy path sets the discount rate for BTC and ETH.'),
      hidden: [{ factId: 'macro:US.PPI', reason: 'Low crypto relevance: the move is already in the price.' }]
    }
    const { runner } = scriptedRunner(selection, written)

    const result = await runDailyBriefAgentTurn({ runner, document: withNoConsensusMacro(), locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    expect(result.document.news.macro.find((item) => item.eventKey === 'US.PPI')).toMatchObject({
      visibility: 'hidden', visibilityReason: 'Low crypto relevance: the move is already in the price.'
    })
  })

  it('never hands the writing model an event whose actual is missing (A0.12)', async () => {
    // 用户 2026-11-05 那类窗口：有事件、还没拿到值。它照常显示（值那一格不渲染），但两份写作素材
    // ——事实卡与选材提示词——都不许出现它，否则模型会把"我们没拿到"写成一句判断。
    const base = withNextCandidates()
    const waiting = {
      eventKey: 'US.EIA', title: 'EIA crude stocks', scheduledAt: '2026-10-29T15:00:00.000Z',
      importance: 'high' as const, surprise: { direction: 'consensus-unavailable' as const }
    }
    const source = {
      ...base,
      news: { ...base.news, macro: [...base.news.macro, waiting], macroCandidates: [...base.news.macro, waiting] },
      notes: { macroHighImpactCount: 2 }
    }
    const selection = {
      stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [],
      focus: 'US.FOMC',
      focusWhy: 'The policy path sets the discount rate for BTC and ETH.'
    }
    const { starts, continues, runner } = scriptedRunner(selection, editorial('US.FOMC', 'The policy path sets the discount rate for BTC and ETH.'))

    const result = await runDailyBriefAgentTurn({ runner, document: source, locale: 'en-US' })

    expect(starts[0]?.displayText).toContain('Macro candidates 1')
    expect(starts[0]?.displayText).not.toContain('EIA crude stocks')
    expect(JSON.stringify(starts[0]?.prompt)).not.toContain('EIA crude stocks')
    expect(continues.join('\n')).not.toContain('EIA crude stocks')
    // 版面不能因为"模型没写过它"就把它藏掉：没有值不等于没有这件事。
    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    const waitingItem = result.document.news.macro.find((item) => item.eventKey === 'US.EIA')
    expect(waitingItem).toMatchObject({ visibility: 'shown' })
    expect(waitingItem?.why).toBeUndefined()
  })

  it('caps the 24h macro section at four releases and audits the omitted ones with a reason', async () => {
    const source = withManyMacro()
    const candidates = source.news.macroCandidates!
    const expected = candidates.slice(0, 4)
    const selection = {
      stage: 'select', news: ['news:n1'], macro: candidates.map((item) => `macro:${item.eventKey}`), next: [],
      focus: 'US.FOMC',
      focusWhy: 'The policy path sets the discount rate for BTC and ETH.'
    }
    const written = {
      ...editorial('US.FOMC', 'The policy path sets the discount rate for BTC and ETH.'),
      items: [
        { factId: 'news:n1', why: 'Stablecoin supply keeps shrinking and pulls bids away.' },
        ...expected.map((item) => ({ factId: `macro:${item.eventKey}`, why: 'The release changes the discount-rate path for BTC.' }))
      ]
    }
    const { runner } = scriptedRunner(selection, written)

    const result = await runDailyBriefAgentTurn({ runner, document: source, locale: 'en-US' })

    expect(result.state).toBe('accepted')
    if (result.state !== 'accepted') return
    expect(result.document.news.macro.map((item) => item.eventKey)).toEqual(expected.map((item) => item.eventKey))
    const hidden = result.document.provenance.selectionAudit?.hidden ?? []
    for (const item of candidates.slice(4)) {
      const entry = hidden.find((candidate) => candidate.factId === `macro:${item.eventKey}`)
      expect(entry?.reason).toBe('macro display cap reached (at most 4)')
    }
  })
})

describe('the repair budget', () => {
  it('rewrites three times and checks four, and every round carries a name', async () => {
    // A run that never produces a valid reply: the model says "{}" every time, so every check fails.
    const { runner } = fakeRunner()
    const stages: { id: string; state: string }[] = []
    const result = await runDailyBriefAgentTurn({
      runner: runner as never,
      document: document('zh-CN'),
      locale: 'zh-CN',
      onStage: (event: { stage: string; state: string }) => { stages.push({ id: event.stage, state: event.state }) }
    })

    expect(result.state).toBe('failed')
    // The number is one constant, and the run honours it: three repairs means four checks.
    expect(maximumRepairRounds).toBe(3)
    const repairs = stages.filter((stage) => stage.id.startsWith('repair-') && stage.state === 'begin').map((stage) => stage.id)
    expect(repairs).toEqual(['repair-1', 'repair-2', 'repair-3'])
    const checks = stages.filter((stage) => stage.id === 'validation' && stage.state === 'begin')
    expect(checks).toHaveLength(maximumRepairRounds + 1)
  })
})

describe('the citable set (Chief 2026-11-06)', () => {
  const selection = {
    stage: 'select', news: ['news:n1'], macro: ['macro:US.CPI'], next: [],
    focus: 'US.FOMC',
    focusWhy: 'The policy path sets the discount rate on BTC and ETH.'
  }

  it('marks which ids the writing pass may cite, and needs no repair when it stays inside them', async () => {
    const { continues, runner } = scriptedRunner(selection, editorial('US.FOMC', selection.focusWhy))
    const stages: { id: string; state: string }[] = []
    const result = await runDailyBriefAgentTurn({
      runner, document: withNextCandidates(), locale: 'en-US',
      onStage: (event: { stage: string; state: string }) => { stages.push({ id: event.stage, state: event.state }) }
    })

    expect(result.state).toBe('accepted')
    // 写作素材里明说"哪些 id 可以被引用"，候选（隐藏的）不在其中。
    const writing = continues.find((text) => text.includes('Write this exact JSON shape')) ?? ''
    expect(writing).toContain('"citable"')
    expect(writing).toContain('"news:n1"')
    expect(writing).toContain('"macro:US.CPI"')
    // 一次过：一版正常产出不该多花一轮修复。
    expect(stages.filter((stage) => stage.id === 'validation' && stage.state === 'begin')).toHaveLength(1)
    expect(stages.filter((stage) => stage.id.startsWith('repair-'))).toHaveLength(0)
  })

  it('names the refused citation in the repair round, so the next try can drop it', async () => {
    const bad = {
      ...editorial('US.FOMC', selection.focusWhy),
      items: [
        { factId: 'news:n1', why: 'Stablecoin supply keeps shrinking and pulls bids away.' },
        { factId: 'macro:US.CPI', why: 'The CPI beat keeps the discount rate higher for longer.' },
        { factId: 'news:dropped-1', why: 'A headline the selection stage left out.' }
      ]
    }
    const { continues, runner } = scriptedRunner(selection, bad)
    await runDailyBriefAgentTurn({ runner, document: withNextCandidates(), locale: 'en-US' })

    const repair = continues.find((text) => text.includes('failed validation')) ?? ''
    expect(repair).toContain('news:dropped-1')
  })
})
