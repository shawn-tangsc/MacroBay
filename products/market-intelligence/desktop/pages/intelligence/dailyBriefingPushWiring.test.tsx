// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { briefingPushText, type BriefingPushFailureKey } from './dailyBriefingPushText'
import { useBriefingPush, type BriefingPushState } from './dailyBriefingPushWiring'

/**
 * The button's state machine, without the button.
 *
 * 两条读者能感知的规矩在这里判，其余靠渲染：
 * - **一个字节都没出站就不许算发过**：渲不出图、导读超长、图太大，三种都不得调用发送；
 * - **只发文字是读者选的路**：它绕开海报那一路，与「失败后自动降级」不是一件事。
 */
const edition = { date: '2026-11-04', periodId: 'default', locale: 'zh-CN' as const }

function mount(input: Parameters<typeof useBriefingPush>[0]) {
  const seen: BriefingPushState[] = []
  let api: ReturnType<typeof useBriefingPush> | undefined
  function Probe(): null {
    api = useBriefingPush(input)
    seen.push(api.state)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(createElement(Probe)) })
  return {
    get api() { return api! },
    get last() { return seen.at(-1)! },
    unmount: () => act(() => root.unmount())
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('the push state machine', () => {
  it('sends once when the reader taps three times', async () => {
    let resolve: ((value: unknown) => void) | undefined
    const send = vi.fn(() => new Promise((done) => { resolve = done }))
    const harness = mount({ edition, send: send as never })
    await act(async () => {
      harness.api.push()
      harness.api.push()
      harness.api.push()
    })
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => { resolve?.({ state: 'result', delivery: 'sent-accepted' }) })
    harness.unmount()
  })

  it('renders the poster first and hands the bytes to the send', async () => {
    const send = vi.fn(async () => ({ state: 'result' as const, delivery: 'sent-accepted' as const }))
    const poster = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' as const }
    const harness = mount({
      edition,
      send: send as never,
      prepare: async () => ({ kind: 'ready-with-poster', poster })
    })
    await act(async () => { harness.api.push() })
    expect(send).toHaveBeenCalledWith(edition, poster)
    expect(harness.last).toEqual({ kind: 'result', delivery: 'sent-accepted', attempt: 'poster' })
    harness.unmount()
  })

  it('does not call the send at all when the poster cannot be rendered', async () => {
    const send = vi.fn(async () => ({ state: 'result' as const, delivery: 'sent-accepted' as const }))
    const harness = mount({ edition, send: send as never, prepare: async () => ({ kind: 'poster-render-failed' }) })
    await act(async () => { harness.api.push() })
    // 产品键就叫 poster-render-failed；一次 IPC 都没发。
    expect(harness.last).toEqual({ kind: 'failed', reason: 'poster-render-failed' })
    expect(send).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('refuses a too-long lede without sending and without truncating anything', async () => {
    const send = vi.fn(async () => ({ state: 'result' as const, delivery: 'sent-accepted' as const }))
    const harness = mount({ edition, send: send as never, prepare: async () => ({ kind: 'caption-too-long', chars: 1300 }) })
    await act(async () => { harness.api.push() })
    expect(harness.last).toEqual({ kind: 'caption-too-long', chars: 1300 })
    expect(send).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('refuses an oversized poster without sending, and reports its length', async () => {
    const send = vi.fn(async () => ({ state: 'result' as const, delivery: 'sent-accepted' as const }))
    const harness = mount({ edition, send: send as never, prepare: async () => ({ kind: 'poster-too-large', byteLength: 9_000_000 }) })
    await act(async () => { harness.api.push() })
    expect(harness.last).toEqual({ kind: 'poster-too-large', byteLength: 9_000_000 })
    expect(send).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('sends text only when the reader picks that action, even if the poster would be refused', async () => {
    const send = vi.fn(async () => ({ state: 'result' as const, delivery: 'sent-accepted' as const }))
    const prepare = vi.fn(async () => ({ kind: 'caption-too-long' as const, chars: 1300 }))
    const harness = mount({ edition, send: send as never, prepare })
    await act(async () => { harness.api.sendTextOnly() })
    // 读者自己选的路：不渲染、不带图，照样发。
    expect(prepare).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(edition, undefined)
    expect(harness.last).toEqual({ kind: 'result', delivery: 'sent-accepted', attempt: 'text' })
    harness.unmount()
  })

  it('leaves a rejection on screen with its reason, and retrying re-runs the flow', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ state: 'failed', reason: 'edition-mismatch' })
      .mockResolvedValueOnce({ state: 'result', delivery: 'sent-accepted' })
    const harness = mount({ edition, send: send as never })
    await act(async () => { harness.api.push() })
    expect(harness.last).toEqual({ kind: 'failed', reason: 'edition-mismatch' })
    await act(async () => { harness.api.retry() })
    expect(harness.last).toEqual({ kind: 'result', delivery: 'sent-accepted', attempt: 'text' })
    harness.unmount()
  })

  it('does nothing while the page says why it cannot send', async () => {
    const send = vi.fn()
    const harness = mount({ edition, blocked: 'generating', send: send as never })
    expect(harness.last).toEqual({ kind: 'disabled', reason: 'generating' })
    await act(async () => { harness.api.push() })
    expect(send).not.toHaveBeenCalled()
    harness.unmount()
  })
})

describe('the push copy', () => {
  it('never claims delivery, in either language', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const text = briefingPushText[locale]
      const sentences = [
        text.sentAll, text.bucketReceived, text.bucketFailed, text.bucketPending,
        text.sentNone, text.sentAcceptedNoRows, text.sentUnconfirmedNoRows, text.notReceivedNoRows,
        text.captionTooLong, text.posterRenderFailed, text.posterTooLarge,
        ...Object.values(text.failed), ...Object.values(text.disabled)
      ].join(' ')
      expect(sentences).not.toMatch(/已送达|已推送|已发送|发送成功|Delivered|Sent successfully/)
    }
  })

  it('keeps the body free of channel names and builds the three buckets without a false "did not arrive"', () => {
    const text = briefingPushText['zh-CN']
    // 正文句只有数字占位，没有 {channel}。
    for (const sentence of [text.sentAll, text.bucketReceived, text.bucketFailed, text.bucketPending, text.sentNone]) {
      expect(sentence).not.toContain('{channel}')
    }
    expect(text.sentAll).toContain('{n}')
    // 三桶各自成段：拼起来就是产品定稿的那句；「还没回执」自成一桶，不与「没到」合并。
    expect([text.bucketReceived, text.bucketFailed, text.bucketPending].join(text.bucketSeparator))
      .toBe('{n} 条收到，{n} 条没到，{n} 条还没回执')
    expect(text.bucketPending).toContain('还没回执')
    // 降级看得出来：形态词与结果词是两样；单看「只发了文字」会让人问「海报是不是丢了」。
    expect(text.channelText).toBe('只发了文字（没有海报）')
    expect(text.channelImage).toBe('发了海报')
  })

  it('names the shorten action by what it does and says it regenerates', () => {
    // 产品定稿：按钮写「改短导读」，ⓘ 必须说透「打开这一期的编辑会话、写短后重新生成」。
    expect(briefingPushText['zh-CN'].shortenLede).toBe('改短导读')
    expect(briefingPushText['zh-CN'].captionTooLongWhy).toContain('编辑会话')
    expect(briefingPushText['zh-CN'].captionTooLongWhy).toContain('重新生成')
    expect(briefingPushText['en-US'].captionTooLongWhy).toContain('regenerate')
  })

  it('gives every rejection and the two poster refusals their own sentence', () => {
    const reasons: readonly BriefingPushFailureKey[] = [
      'channel-not-configured', 'channel-disconnected', 'channel-rate-limited', 'capability-missing', 'invoke-failed', 'receipt-unknown', 'push-paused', 'record-missing', 'edition-mismatch', 'surface-invalid', 'poster-refused', 'poster-render-failed'
    ]
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const reason of reasons) {
        expect(briefingPushText[locale].failed[reason].trim().length).toBeGreaterThan(0)
      }
    }
    // 版次不符与「没有同键记录」是同一件事，一句就够。
    expect(briefingPushText['zh-CN'].failed['record-missing']).toBe(briefingPushText['zh-CN'].failed['edition-mismatch'])
    expect(briefingPushText['zh-CN'].failedTitle).toBe('没发布出去')
  })
})
