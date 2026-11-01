import { describe, expect, it, vi } from 'vitest'

import { resolveMarketAnalysisConsumerRegistration } from './registerMarketAnalysisRuntime'

describe('market analysis consumer declaration', () => {
  it('reads its topics and handler from the manifest, so there is one place to edit', () => {
    const registration = resolveMarketAnalysisConsumerRegistration()

    expect(registration?.topics).toHaveLength(3)
    expect(registration?.handlerId).toBeTruthy()
  })

  /**
   * 白窗那一类失败的形状：这段跑在 `registerProductServices` 里，抛出去会被
   * `app.ts:2630` 的 catch 吞掉并提前 return，主窗（`:2723`）根本不加载。
   * 所以缺声明只许报一条具名诊断，不许抛。
   */
  it('reports a missing declaration by name instead of throwing into the bootstrap', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(resolveMarketAnalysisConsumerRegistration({ eventConsumers: [] })).toBeNull()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('market-intelligence.event-consumer-undeclared'))

    error.mockRestore()
  })
})
