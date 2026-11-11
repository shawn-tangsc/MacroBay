// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { subscribeIntelligenceDataChanged } from './intelligenceDataChangedClient'

afterEach(() => {
  // 用例里替换过全局读口，跑完必须还原，否则同文件后面的用例会看到假的平台。
  Reflect.deleteProperty(window, 'platform')
})

describe('subscribeIntelligenceDataChanged', () => {
  it('subscribes on the product event channel with the agreed event name', () => {
    const unsubscribe = vi.fn()
    const onEvent = vi.fn(() => unsubscribe)
    Object.defineProperty(window, 'platform', { configurable: true, value: { products: { onEvent } } })

    const listener = vi.fn()
    const stop = subscribeIntelligenceDataChanged(listener)

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith('market-intelligence', 'intelligence.dataChanged', expect.any(Function))
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('hands the listener a parsed payload and swallows a malformed one', () => {
    const handlers: Array<(data: unknown) => void> = []
    Object.defineProperty(window, 'platform', {
      configurable: true,
      value: { products: { onEvent: (_product: string, _event: string, handler: (data: unknown) => void) => { handlers.push(handler); return () => undefined } } }
    })

    const listener = vi.fn()
    subscribeIntelligenceDataChanged(listener)
    expect(handlers).toHaveLength(1)

    handlers[0]!({ panels: ['dashboard'], sources: ['alternative-fear-greed'] })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]![0]).toEqual({ panels: ['dashboard'], sources: ['alternative-fear-greed'] })

    handlers[0]!({ panels: 'dashboard' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the host has no product event channel', () => {
    // 不是桌面宿主（或通道没接上）时：不抛错、不重试，最多是「等兜底轮询」。
    expect(() => subscribeIntelligenceDataChanged(() => undefined)()).not.toThrow()
  })
})
