// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { briefingPushAvailable, redeliverBriefingPush } from './dailyBriefingPushClient'

/**
 * The reader's push, from the click to the sentence.
 *
 * Two things are pinned here and they are the ones a screenshot cannot show: what the platform is
 * asked (the day's key, the screen's edition, the screen's language) and what a rejection is called.
 * A wrong key pushes nothing; a wrong edition pushes a different issue; a code shown raw is a sentence
 * the reader cannot act on.
 */
const edition = { date: '2026-11-04', periodId: 'default', locale: 'en-US' as const }

/** 发布走产品 IPC：主进程先写/更新记录，再重投。渲染层只发一个请求。 */
function stubBridge(result: unknown): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async () => result)
  vi.stubGlobal('window', { platform: { products: { invoke } } })
  return invoke
}

afterEach(() => vi.unstubAllGlobals())

describe('the push client', () => {
  it('asks for the edition on screen, in its own language, through the product bridge', async () => {
    const invoke = stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    await redeliverBriefingPush(edition)
    // One call: 主进程内部先写记录、暂存海报、再投递，渲染层不该自己拼那几步。
    // 没有海报就不带 `poster` 这个键（只发文字的既有路径一字不变）。
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dailyBriefing.publishToPhone', {
      date: '2026-11-04', periodId: 'default', locale: 'en-US'
    })
  })

  it('carries the poster bytes when the caller has them', async () => {
    const invoke = stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    const poster = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
    await redeliverBriefingPush(edition, poster)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dailyBriefing.publishToPhone', {
      date: '2026-11-04', periodId: 'default', locale: 'en-US', poster
    })
  })

  it('reads the receipt, not the port: a send without one is not called sent', async () => {
    stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-unconfirmed' } })
    expect(await redeliverBriefingPush(edition)).toEqual({ state: 'result', delivery: 'sent-unconfirmed' })

    stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    expect(await redeliverBriefingPush(edition)).toEqual({ state: 'result', delivery: 'sent-accepted' })
  })

  it('hands every per-channel row back, kind included, so the screen can count and say who got text', async () => {
    stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
      { channelId: 'c2', channelName: '飞书群', state: 'sent-accepted', kind: 'text' },
      { channelId: 'c3', channelName: '邮件', state: 'failed', reason: 'channel-rejected', kind: 'text' }
    ] } })
    expect(await redeliverBriefingPush(edition)).toEqual({
      state: 'result',
      delivery: 'failed',
      channels: [
        { channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
        { channelName: '飞书群', state: 'sent-accepted', kind: 'text' },
        { channelName: '邮件', state: 'failed', reason: 'channel-rejected', kind: 'text' }
      ]
    })
  })

  it('names each rejection in words a reader can act on', async () => {
    for (const [code, reason] of [
      ['redeliver-target-missing', 'record-missing'],
      ['redeliver-edition-mismatch', 'edition-mismatch'],
      ['redeliver-surface-invalid', 'surface-invalid'],
      ['push-paused', 'push-paused'],
      ['channel-missing', 'channel-not-configured'],
      // 主进程先写后推之后，剩下的「记录不在」其实是「这一版还没生成」：读者要做的事一样，同一句。
      ['edition-missing', 'record-missing'],
      ['runtime-unavailable', 'capability-missing'],
      // 带图发布整条被拒（来源对不上等）：不降级，读者自己选只发文字。
      ['poster-refused', 'poster-refused'],
      // 认不出的拒绝码：不冒充任何具体原因，落「回执不认识」。
      ['some-new-platform-code', 'receipt-unknown']
    ] as const) {
      stubBridge({ kind: 'rejected', reason: code })
      // The platform's code never reaches the screen; the card gets one of these names.
      expect(await redeliverBriefingPush(edition)).toEqual({ state: 'failed', reason })
    }
  })

  it('tells three failures apart: no capability, request not sent, unrecognised receipt', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => { errors.push(String(line)) })
    try {
      // ① 能力不在：产品桥没装配——不是「服务没启动」。
      vi.stubGlobal('window', {})
      expect(briefingPushAvailable()).toBe(false)
      expect(await redeliverBriefingPush(edition)).toEqual({ state: 'failed', reason: 'capability-missing' })

      // ② 请求没发出去：桥抛了，原文进日志。
      vi.stubGlobal('window', { platform: { products: { invoke: async () => { throw new Error('ipc-closed') } } } })
      expect(await redeliverBriefingPush(edition)).toEqual({ state: 'failed', reason: 'invoke-failed' })

      // ③ 回执形状不认识：不冒充任何一种具体原因。
      stubBridge('not-a-receipt')
      expect(await redeliverBriefingPush(edition)).toEqual({ state: 'failed', reason: 'receipt-unknown' })

      const markers = errors.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.marker === 'MI_DAILY_BRIEF_PUSH_FAILED')
      expect(markers.map((entry) => entry.reason)).toEqual(['capability-missing', 'invoke-failed', 'receipt-unknown'])
      // 原文留在日志里：异常名与消息、以及回执的形态。
      expect(markers[1]?.detail).toContain('ipc-closed')
      expect(markers[2]?.detail).toBe('shape:string')
    } finally {
      spy.mockRestore()
    }
  })
})
