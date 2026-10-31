import { describe, expect, it, vi } from 'vitest'

import {
  buildDivergenceMessages,
  createDivergenceJudgementService,
  parseJudgementOutput,
  type DivergenceJudgementInput
} from './divergenceJudgementService'

const input: DivergenceJudgementInput = {
  asOf: '2026-10-30T12:00:00.000Z',
  pairs: [
    { pairId: 'liquidity-leverage', ruleVerdict: 'divergence', legs: [
      { id: 'stablecoin', value: -1.2, unit: 'percent', observedAt: '2026-10-30T10:00:00.000Z' },
      { id: 'open-interest', value: 3.4, unit: 'percent', observedAt: '2026-10-30T11:00:00.000Z' },
      { id: 'funding', value: -0.0032, unit: 'percent-per-8h', observedAt: '2026-10-30T11:00:00.000Z' }
    ] },
    { pairId: 'narrative-price', ruleVerdict: 'agreement', legs: [
      { id: 'sentiment', value: 30, unit: 'percent', observedAt: '2026-10-30T11:00:00.000Z' },
      { id: 'price', value: -0.2, unit: 'percent', observedAt: '2026-10-30T11:00:00.000Z' },
      { id: 'open-interest', value: 0.4, unit: 'percent', observedAt: '2026-10-30T11:00:00.000Z' }
    ] }
  ]
}

const answer = JSON.stringify({ judgements: [
  { pair: 'liquidity-leverage', verdict: 'divergence', direction: 'bearish', mechanism: '稳定币七天里少了 1.21%，说明能用来买币的现金在减少；但永续空头反而在加仓 3.4%，两边方向相反。这意味着价格一旦反弹，空头被迫平仓会放大涨幅。', invalidation: '稳定币 7 天转正。' },
  { pair: 'narrative-price', verdict: 'agreement' }
] })

function invoker(raw: string) {
  return vi.fn(async ({ parse }: { parse: (value: unknown) => unknown }) => ({ ok: true as const, output: parse(raw) }))
}
const defaults = async () => ({ assistantModelId: 'openai:gpt-5', agentModelId: '', fastModelId: '', translationModelId: '', imageModelId: '' })
const providers = async () => ({ providers: [{ id: 'openai', enabled: true, baseUrl: 'https://api.example.com', hasApiKey: true, connectionStatus: 'ready', models: [{ id: 'gpt-5', capabilities: { chat: true } }] }] as never })

describe('divergence judgement', () => {
  it('sends the readings and forbids new numbers', () => {
    const [system, user] = buildDivergenceMessages(input)
    expect(system!.content).toContain('只能使用输入里给出的数字')
    expect(user!.content).toContain('"stablecoin"')
    expect(user!.content).toContain('-1.2')
  })

  it('accepts a strict answer that covers every pair', () => {
    expect(parseJudgementOutput(answer, input)?.map(entry => entry.verdict)).toEqual(['divergence', 'agreement'])
  })

  it.each([
    ['a missing pair', JSON.stringify({ judgements: [{ pair: 'liquidity-leverage', verdict: 'divergence', direction: 'bearish', mechanism: 'a', invalidation: 'b' }] })],
    ['an unknown pair', JSON.stringify({ judgements: [{ pair: 'made-up', verdict: 'agreement' }, { pair: 'liquidity-leverage', verdict: 'agreement' }, { pair: 'narrative-price', verdict: 'agreement' }] })],
    ['a verdict without a direction', JSON.stringify({ judgements: [{ pair: 'liquidity-leverage', verdict: 'divergence', mechanism: 'a', invalidation: 'b' }, { pair: 'narrative-price', verdict: 'agreement' }] })],
    ['prose instead of JSON', 'The market looks mixed today.']
  ])('refuses %s', (_name, raw) => {
    expect(parseJudgementOutput(raw, input)).toBeNull()
  })

  it('falls back to no-model when the default assistant model is not configured', async () => {
    const service = createDivergenceJudgementService({
      invoke: invoker(answer) as never,
      getProviderState: providers,
      getModelDefaults: async () => ({ assistantModelId: '', agentModelId: '', fastModelId: '', translationModelId: '', imageModelId: '' })
    })
    await expect(service.judge(input)).resolves.toEqual({ state: 'unavailable', reason: 'no-model' })
  })

  it('answers once per set of readings and reuses the cache', async () => {
    const invoke = invoker(answer)
    const service = createDivergenceJudgementService({ invoke: invoke as never, getProviderState: providers, getModelDefaults: defaults })
    const first = await service.judge(input)
    const second = await service.judge(input)
    expect(first.state).toBe('judged')
    expect(second).toEqual(first)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe('caching', () => {
  it('reuses an answer for the same readings, and re-asks when forced', async () => {
    const invoke = invoker(answer)
    const service = createDivergenceJudgementService({ invoke: invoke as never, getProviderState: providers, getModelDefaults: defaults })
    await service.judge(input)
    await service.judge(input)
    expect(invoke).toHaveBeenCalledTimes(1)
    // The reader pressed 重新判定: the cached answer is not what they asked for.
    await service.judge(input, { force: true })
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
