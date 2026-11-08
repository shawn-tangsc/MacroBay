import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundService } from '../ChannelInboundService'
import type { TelegramApiClient } from './TelegramApiClient'
import type { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramPollingHost } from './TelegramPollingHost'

/**
 * 「频道连不上」在**真轮询循环**里的行为（需求 v2.17 §11.1、第 8 条）：断开满 30 秒才一条，
 * 重试过程不刷屏，7 秒抖动一条都不报。
 *
 * 这里不开真定时器：`setTimeout` 注入成一个队列，测试手动放行每一次尝试，时钟也注入，
 * 所以「几点断的、断了多久」可以逐字段断言，不用真等半分钟。
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
    /**
     * 放行排着的那一次尝试，并等它的 await 链跑完。
     *
     * 等的是**事实**——循环又排上了下一次尝试（`timers` 多了一项）；不是等两个 `setTimeout(0)`。
     * 后者只是「把事件循环推两轮」，属于用时间当同步手段：慢机器上两轮不够就假红，而快机器上
     * 两轮又可能掩盖「这一拍根本没跑完」。纯 microtask 推进加一个有界轮数，跑完即返回。
     */
    async pump() {
      const next = timers.shift()
      expect(next, '轮询循环没有排下一次尝试').toBeDefined()
      next?.()
      const queuedBefore = timers.length
      for (let turn = 0; turn < 50 && timers.length === queuedBefore; turn += 1) {
        await Promise.resolve()
      }
    }
  }
}

describe('Telegram polling host: channel connection lost', () => {
  it('reports once after 30 seconds of downtime, then stays quiet for the same outage', async () => {
    const harness = createHarness()
    harness.updates.mockResolvedValue({ ok: false, code: 'telegram-proxy-unavailable' })
    harness.host.start()

    // 真实的退避节奏：0s / 1s / 3s / 7s / 15s。
    for (const step of [0, 1_000, 2_000, 4_000, 8_000]) {
      harness.advance(step)
      await harness.pump()
    }
    expect(harness.lost).toHaveLength(0)

    harness.advance(16_000)
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

  it('reports nothing for a seven-second flutter, and treats the next real outage as new', async () => {
    const harness = createHarness()
    harness.updates.mockResolvedValue({ ok: false, code: 'telegram-network-unavailable' })
    harness.host.start()
    // 7 秒内失败三次：这是合盖唤醒 / 切 Wi-Fi / 代理重连抖一下的样子，不是断线。
    for (const step of [0, 1_000, 6_000]) {
      harness.advance(step)
      await harness.pump()
    }
    harness.updates.mockResolvedValue({ ok: true, value: [] })
    await harness.pump()
    expect(harness.lost).toHaveLength(0)

    // 真的断了：从这次的第一刻起满 30 秒才报，且带这次自己的起始时刻。
    harness.updates.mockResolvedValue({ ok: false, code: 'telegram-network-unavailable' })
    const outageStart = 9_000
    harness.advance(1_000)
    await harness.pump()
    harness.advance(30_000)
    await harness.pump()
    expect(harness.lost).toEqual([{ cause: 'network', disconnectedAt: new Date(outageStart).toISOString() }])
  })

  it('does not call a rate limit, a conflict or a rejected token a lost connection', async () => {
    for (const code of ['telegram-rate-limited', 'telegram-conflict', 'telegram-provider-rejected']) {
      const harness = createHarness()
      harness.updates.mockResolvedValue({ ok: false, code })
      harness.host.start()
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await harness.pump()
        harness.advance(40_000)
      }
      expect(harness.lost, code).toHaveLength(0)
    }
  })

  it('counts a thrown transport failure, but never an unrelated crash in the loop', async () => {
    const transport = createHarness()
    transport.updates.mockRejectedValue(new TypeError('fetch failed'))
    transport.host.start()
    await transport.pump()
    transport.advance(31_000)
    await transport.pump()
    expect(transport.lost).toEqual([{ cause: 'network', disconnectedAt: new Date(1_000).toISOString() }])

    // 入站/存储抛出的普通异常不是网络问题：报成「连不上」会把读者带去查错地方。
    const internal = createHarness()
    internal.updates.mockRejectedValue(new Error('database is locked'))
    internal.host.start()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await internal.pump()
      internal.advance(40_000)
    }
    expect(internal.lost).toHaveLength(0)
  })

  // 为什么没有「两条频道同时断开、键不串」这条：单频道不变量（同一时间只允许一条频道启用）下
  // 这个状态产品上不可达；要造它就必须直接注入 host、绕过不变量——测一个不存在的状态，成本比
  // 收益高。验收按「不适用 + 理由」记，不是漏测（Chief 2026-11-04 定）。
})
