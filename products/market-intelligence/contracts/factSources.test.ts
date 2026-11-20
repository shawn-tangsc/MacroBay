import { describe, expect, it } from 'vitest'

import { resolveFactSource } from './factSources'

/**
 * 事实归属的解析：谁在供数由配置算出来，不写死 id。
 * 判据是「声明了 + 读者开着 + 作业真的注册着 + 就绪」——**不是配置页那个开关**：
 * 聚合锚就是开关显示开、系统不排期的反例。
 */
const etf = (overrides: Record<string, unknown> = {}) => ({
  sourceId: 'cryptoetf-etf-flows', provides: ['etf-net-flow' as const],
  enabled: true, jobRegistered: true, readiness: 'live', ...overrides
})

describe('resolveFactSource', () => {
  it('resolves the one source that declares the fact and really runs', () => {
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: [etf()] }))
      .toEqual({ kind: 'resolved', sourceId: 'cryptoetf-etf-flows' })
  })

  it('answers none — never a guess — when the reader switches it off', () => {
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: [etf({ enabled: false })] })).toEqual({ kind: 'none' })
  })

  it('answers none for a source whose switch looks on but no job is registered', () => {
    // 聚合锚的现场形态：开关是开的，作业没注册。旧解析按开关算会采一个不存在的源。
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: [etf({ jobRegistered: false })] })).toEqual({ kind: 'none' })
  })

  it('answers none for a source that declares nothing or is not ready', () => {
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: [etf({ provides: [] })] })).toEqual({ kind: 'none' })
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: [etf({ readiness: 'planned' })] })).toEqual({ kind: 'none' })
  })

  it('fails closed with every candidate when two sources both claim the fact', () => {
    const second = etf({ sourceId: '0xrouter-aggregate-provider' })
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: [etf(), second] }))
      .toEqual({ kind: 'conflict', sourceIds: ['cryptoetf-etf-flows', '0xrouter-aggregate-provider'] })
  })
})
