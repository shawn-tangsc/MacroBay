// @vitest-environment happy-dom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSingleFlightSend, type SingleFlightSend } from './useSingleFlightSend'

/**
 * 连点守卫的**唯一判据**（用户 2026-11-09：点 4 次收到 4 条自检）。
 *
 * 四条都要能红：连点 5 次只发 1 条；冷却期内再点不发；冷却过后能再发；**失败不进入冷却**。
 */

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(options: Parameters<typeof useSingleFlightSend>[0]): Promise<{
  api: () => SingleFlightSend
}> {
  let latest: SingleFlightSend | undefined
  function Probe(): null {
    latest = useSingleFlightSend(options)
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(Probe)))
  return { api: () => latest as SingleFlightSend }
}

describe('useSingleFlightSend', () => {
  it('collapses five rapid clicks into one send', async () => {
    const send = vi.fn(async () => true)
    const { api } = await mount({ cooldownMs: 10_000, send })
    await act(async () => {
      const runs = [api().run(), api().run(), api().run(), api().run(), api().run()]
      await Promise.all(runs)
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses to send during the cooldown, then allows it again once the clock passes', async () => {
    let clock = 1_000
    const send = vi.fn(async () => true)
    const { api } = await mount({ cooldownMs: 10_000, now: () => clock, send })

    await act(async () => {
      expect(await api().run()).toBe('sent')
    })
    expect(send).toHaveBeenCalledTimes(1)

    clock = 5_000
    await act(async () => {
      expect(await api().run()).toBe('cooldown')
    })
    expect(send).toHaveBeenCalledTimes(1)

    clock = 11_001
    await act(async () => {
      expect(await api().run()).toBe('sent')
    })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not start a cooldown after a failure — a failed send must stay retryable', async () => {
    let clock = 1_000
    const send = vi.fn(async () => false)
    const { api } = await mount({ cooldownMs: 10_000, now: () => clock, send })

    await act(async () => {
      expect(await api().run()).toBe('failed')
    })
    clock = 1_500
    await act(async () => {
      expect(await api().run()).toBe('failed')
    })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('reports the remaining cooldown in whole seconds, up to the ceiling', async () => {
    vi.useFakeTimers()
    try {
      let clock = 1_000
      const { api } = await mount({ cooldownMs: 10_000, now: () => clock, send: async () => true })
      await act(async () => {
        await api().run()
      })
      // 冷却到期前的读数由每秒一次的 tick 重算（不靠调用方再点一次）。
      clock = 3_400
      await act(async () => {
        vi.advanceTimersByTime(1_000)
      })
      // 剩余 7_600ms，向上取整成 8 秒——「还有几秒」宁可多说一秒，也不说成 0 让人白点。
      expect(api().cooldownSecondsLeft).toBe(8)
    } finally {
      vi.useRealTimers()
    }
  })
})
