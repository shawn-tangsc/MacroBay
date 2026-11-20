import { describe, expect, it } from 'vitest'

import { marketIntelligenceProductManifest } from '../../../../product.manifest'
import { MACRO_INDICATOR_IPC_METHODS, registerMacroIndicatorIpc } from './registerMacroIndicatorIpc'
import type { MacroIndicatorCardFact } from '../macroIndicatorCardFacts'

type Handler = (payload: unknown) => unknown | Promise<unknown>

function registrar(): Readonly<{ methods: string[]; handlers: Map<string, Handler>; register: (productId: string, method: string, handler: Handler) => void }> {
  const methods: string[] = []
  const handlers = new Map<string, Handler>()
  return {
    methods,
    handlers,
    register(productId, method, handler) {
      expect(productId).toBe('market-intelligence')
      methods.push(method)
      handlers.set(method, handler)
    }
  }
}

const facts: readonly MacroIndicatorCardFact[] = [
  { metricKey: 'US.NONFARM.SA.CHANGE', state: 'provided', value: 165, previousAsPublished: 29, unit: 'thousands', source: 'narwhal', period: '2026-10', releasedAt: '2026-11-06T13:30:00.000Z' },
  { metricKey: 'US.CORE_PCE.SA.YOY', state: 'not-recorded' }
]

describe('registerMacroIndicatorIpc', () => {
  it('registers one read method and answers with the four facts', async () => {
    const register = registrar()
    registerMacroIndicatorIpc(register.register, { read: async () => facts }, () => '2026-11-13T10:00:00.000Z')

    expect(register.methods).toEqual([MACRO_INDICATOR_IPC_METHODS.read])
    const answer = await register.handlers.get(MACRO_INDICATOR_IPC_METHODS.read)?.({ asOf: '2026-11-13T09:00:00.000Z' })
    expect(answer).toMatchObject({ state: 'available', asOf: '2026-11-13T09:00:00.000Z' })
  })

  /**
   * 下一期与上一期的出处必须**真的出门**：这一层曾经只列了本期的六个字段，
   * 整个 `next` 被吃掉——真机上三张卡因此没有下次发布、没有倒计时，看起来「什么数据都没有」。
   */
  it('sends the next release with its expectation and the previous value provenance', async () => {
    const register = registrar()
    registerMacroIndicatorIpc(register.register, {
      read: async () => [
        {
          ...facts[0]!, previousSource: 'fred', previousObservedAt: '2026-09-01T00:00:00.000Z',
          next: {
            period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z', timePrecision: 'minute',
            expected: { value: 112.5, provenance: 'market-implied', asOf: '2026-11-13T20:40:00.000Z', marketVolume: 5285 }
          }
        } as MacroIndicatorCardFact,
        facts[1]!
      ]
    }, () => '2026-11-13T10:00:00.000Z')

    const answer = await register.handlers.get(MACRO_INDICATOR_IPC_METHODS.read)?.({}) as { facts: readonly Record<string, unknown>[] }
    const payrolls = answer.facts[0]!
    expect(payrolls.previousSource).toBe('fred')
    expect(payrolls.next).toEqual({
      period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z', timePrecision: 'minute',
      expected: { value: 112.5, provenance: 'market-implied', asOf: '2026-11-13T20:40:00.000Z', marketVolume: 5285 }
    })
  })

  /**
   * 渲染层拿不到原始行：这条断的是「payload 里只有那几个可见字段」。
   *
   * 观测行上的 `market_fact_key`、源内 `measure` 名这类内部标识一旦跟着 fact 出门，
   * 就等于给窗口开了第二个查询入口——它们不是给读者看的事实。
   */
  it('sends only the public fact fields, never the raw observation identity', async () => {
    const register = registrar()
    registerMacroIndicatorIpc(register.register, {
      read: async () => [
        { ...facts[0]!, marketFactKey: '["0xrouter","x"]', measure: 'nonfarm_payrolls_change' } as MacroIndicatorCardFact,
        facts[1]!
      ]
    }, () => '2026-11-13T10:00:00.000Z')

    const answer = await register.handlers.get(MACRO_INDICATOR_IPC_METHODS.read)?.({}) as { facts: readonly Record<string, unknown>[] }
    const allowed = ['metricKey', 'state', 'period', 'releasedAt', 'value', 'previousAsPublished', 'unit', 'source',
      'previousSource', 'previousObservedAt', 'previousUnreadable', 'consensus', 'next']
    for (const fact of answer.facts) {
      expect(Object.keys(fact).filter((key) => !allowed.includes(key))).toEqual([])
      expect(fact).not.toHaveProperty('marketFactKey')
      expect(fact).not.toHaveProperty('measure')
    }
  })

  it('reports a failed read as unavailable rather than as an indicator without a value', async () => {
    const register = registrar()
    registerMacroIndicatorIpc(register.register, { read: async () => { throw new Error('disk') } })

    expect(await register.handlers.get(MACRO_INDICATOR_IPC_METHODS.read)?.({})).toEqual({ state: 'unavailable', failureCode: 'unreadable' })
  })

  it('falls back to the current instant when the payload carries no canonical as-of', async () => {
    const register = registrar()
    const seen: string[] = []
    registerMacroIndicatorIpc(register.register, {
      read: async ({ asOf }) => { seen.push(asOf); return [] }
    }, () => '2026-11-13T10:00:00.000Z')

    await register.handlers.get(MACRO_INDICATOR_IPC_METHODS.read)?.({ asOf: '2026-11-13' })
    expect(seen).toEqual(['2026-11-13T10:00:00.000Z'])
  })

  /**
   * 一处事实一处定义：方法名在清单里**只能出现一次**，重复登记会让 `seal()` 拒绝启动
   * （2026-11-06 `3224c49` 那次事故的形状）。
   */
  it('is declared in the product manifest exactly once', () => {
    const declared = marketIntelligenceProductManifest.serviceRoutes
      .map((entry) => entry.method)
      .filter((method) => method === MACRO_INDICATOR_IPC_METHODS.read)

    expect(declared).toEqual([MACRO_INDICATOR_IPC_METHODS.read])
  })
})
