import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundService } from '../ChannelInboundService'
import type { TelegramApiClient } from './TelegramApiClient'
import type { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramPollingHost } from './TelegramPollingHost'

/**
 * 「频道连不上」在**真轮询循环**里的行为（需求 v2.17 §11.1）：自动重连失败之后一条，重试过程不刷屏。
 *
 * 这里不开真定时器：`setTimeout` 注入成一个队列，测试手动放行每一次尝试，时钟也注入，
 * 所以「几点断的」可以逐字段断言，不用等 7 秒。
 */
function createHarness() {
  const timers: Array<() => void> = []
  const lost: Array<{ cause: string; disconnectedAt: string }> = []
  let clock = 1_000
  const updates = vi.fn()
  const host = new TelegramPollingHost({
    channelId: 'channel-1',
    generation: 1,
    inbound: {} as unknown as ChannelInboundService,
    offsets: {
      get: () => 0,
      auditIfCurrent: () => true,
      commitIfCurrent: () => true
    } as unknown as TelegramOffsetRepository,
    api: { updates } as unknown as TelegramApiClient,
    isCurrent: () => true,
    signal: new AbortController().signal,
    onConnectionLost: (input) => lost.push(input),
    now: () => clock,
    setTimeout: (callback) => {
      timers.push(callback)
      return 0 as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: () => {}
  })
  return {
    host,
    updates,
    lost,
    advance(ms: number) { clock += ms },
    /** 放行排着的那一次尝试，并等它的 await 链跑完。 */
    async pump() {
      const next = timers.shift()
      expect(next, '轮询循环没有排下一次尝试').toBeDefined()
      next?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

describe('Telegram polling host: channel connection lost', () => {
  it('reports once after automatic reconnection fails, then stays quiet for the same outage', async () => {
    const harness = createHarness()
    harness.updates.mockResolvedValue({ ok: false, code: 'telegram-proxy-unavailable' })
    harness.host.start()

    await harness.pump()
    harness.advance(1_000)
    await harness.pump()
    expect(harness.lost).toHaveLength(0)

    harness.advance(2_000)
    await harness.pump()
    // 断开起始时刻是**第一次**失败那一刻，不是触发提交的那一次。
    expect(harness.lost).toEqual([{ cause: 'proxy', disconnectedAt: new Date(1_000).toISOString() }])

    // 断网十分钟＝几十次重试：一条都不能再多。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      harness.advance(60_000)
      await harness.pump()
    }
    expect(harness.lost).toHaveLength(1)
  })

  it('never reports a blip that recovers, and treats the next outage as a new one', async () => {
    const harness = createHarness()
    harness.updates.mockResolvedValue({ ok: false, code: 'telegram-network-unavailable' })
    harness.host.start()
    await harness.pump()
    harness.advance(1_000)
    await harness.pump()

    // 接到一条更新（哪怕没有新消息）＝连上了：这次断开到此为止。
    harness.updates.mockResolvedValue({ ok: true, value: [] })
    harness.advance(4_000)
    await harness.pump()
    expect(harness.lost).toHaveLength(0)

    harness.updates.mockResolvedValue({ ok: false, code: 'telegram-network-unavailable' })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      harness.advance(10_000)
      await harness.pump()
    }
    // 恢复后第一次失败在 16s（前面 6s 是恢复那一跳），新的断开起始时刻就是它。
    expect(harness.lost).toEqual([{ cause: 'network', disconnectedAt: new Date(16_000).toISOString() }])
  })

  it('does not call a rate limit, a conflict or a rejected token a lost connection', async () => {
    for (const code of ['telegram-rate-limited', 'telegram-conflict', 'telegram-provider-rejected']) {
      const harness = createHarness()
      harness.updates.mockResolvedValue({ ok: false, code })
      harness.host.start()
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await harness.pump()
        harness.advance(1_000)
      }
      expect(harness.lost, code).toHaveLength(0)
    }
  })

  it('counts a thrown transport failure, but never an unrelated crash in the loop', async () => {
    const transport = createHarness()
    transport.updates.mockRejectedValue(new TypeError('fetch failed'))
    transport.host.start()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await transport.pump()
      transport.advance(1_000)
    }
    expect(transport.lost).toEqual([{ cause: 'network', disconnectedAt: new Date(1_000).toISOString() }])

    // 入站/存储抛出的普通异常不是网络问题：报成「连不上」会把读者带去查错地方。
    const internal = createHarness()
    internal.updates.mockRejectedValue(new Error('database is locked'))
    internal.host.start()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await internal.pump()
      internal.advance(1_000)
    }
    expect(internal.lost).toHaveLength(0)
  })
})
