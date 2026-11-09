import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundService } from '../ChannelInboundService'
import type { TelegramApiClient } from './TelegramApiClient'
import type { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramPollingHost, telegramPollRecoveryPolicy } from './TelegramPollingHost'

/**
 * 自动重连的**读者可见三态**：重试中 / 已恢复 / 已放弃（2026-11-08）。
 *
 * 为什么必须有用例：以前失败只写一行审计然后无限重试，`channel_runtime_audits` 一片空白就分不出
 * 「恢复了」还是「停了」——读者那边的感受是「收不到消息，也没人告诉我为什么」。
 * 这里用注入定时器手动放行每一拍，不睡真实时间。
 */
function createHarness() {
  const timers: Array<() => void> = []
  const audits: string[] = []
  let clock = 1_000
  const updates = vi.fn()
  const host = new TelegramPollingHost({
    channelId: 'channel-1',
    generation: 1,
    inbound: {} as unknown as ChannelInboundService,
    offsets: {
      get: () => 0,
      auditIfCurrent: (_channelId: string, _generation: number, code: string) => { audits.push(code); return true },
      commitIfCurrent: () => true
    } as unknown as TelegramOffsetRepository,
    api: { updates } as unknown as TelegramApiClient,
    isCurrent: () => true,
    signal: new AbortController().signal,
    now: () => clock,
    setTimeout: (callback: () => void) => { timers.push(callback); return 0 as unknown as ReturnType<typeof setTimeout> },
    clearTimeout: () => {}
  })
  return {
    host,
    updates,
    audits,
    pending: () => timers.length,
    advance(ms: number) { clock += ms },
    async pump(): Promise<void> {
      const next = timers.shift()
      expect(next, '轮询循环没有排下一次尝试').toBeDefined()
      next?.()
      const queuedBefore = timers.length
      for (let turn = 0; turn < 50 && timers.length === queuedBefore; turn += 1) await Promise.resolve()
    }
  }
}

describe('Telegram polling host: automatic recovery', () => {
  it('goes retrying after a failure, then recovers on the first success, with both states on record', async () => {
    const harness = createHarness()
    harness.updates.mockRejectedValueOnce(new Error('getUpdates timed out'))
    harness.host.start()
    await harness.pump()

    expect(harness.host.status()).toEqual({ state: 'retrying', consecutiveFailures: 1 })
    // 这一次断开只写一行「正在重试」：**每次尝试不再一行一条**（用户报「整屏被同一种红行刷满」）。
    expect(harness.audits).toEqual(['telegram-poll-retrying'])

    harness.updates.mockResolvedValue({ ok: true, value: [] })
    harness.advance(1_000)
    await harness.pump()

    expect(harness.host.status()).toEqual({ state: 'recovered', consecutiveFailures: 0 })
    expect(harness.audits).toContain('telegram-poll-recovered')
    expect(harness.audits.filter((code) => code === 'telegram-poll-retrying')).toHaveLength(1)
  })

  it('stops retrying at the cap and says so instead of retrying forever in silence', async () => {
    const harness = createHarness()
    harness.updates.mockRejectedValue(new Error('boom'))
    harness.host.start()

    for (let attempt = 0; attempt < telegramPollRecoveryPolicy.maximumConsecutiveFailures; attempt += 1) {
      await harness.pump()
      harness.advance(telegramPollRecoveryPolicy.maximumDelayMs)
    }

    expect(harness.host.status()).toEqual({
      state: 'abandoned',
      consecutiveFailures: telegramPollRecoveryPolicy.maximumConsecutiveFailures
    })
    expect(harness.audits.at(-1)).toBe('telegram-poll-abandoned')
    // 到上限就不再排下一拍：空白审计不再是「不知道」，而是「停在这里」。
    expect(harness.pending()).toBe(0)
  })
})
