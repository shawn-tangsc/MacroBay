// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { briefingPushText, fillBriefingPush, type BriefingPushFailureKey } from './dailyBriefingPushText'
import { briefingPushToastMs, useBriefingPush, type BriefingPushState } from './dailyBriefingPushWiring'

/**
 * The button's state machine, without the button.
 *
 * What a reader can do wrong here is a click, and the machine is what decides whether that click reaches the
 * phone. The three rules that matter — one send per tap even when the network is slow, a rejection that
 * names its reason, and two success sentences that stay different lengths — are all checkable here.
 */
const edition = { date: '2026-11-04', periodId: 'default', locale: 'zh-CN' }

function mount(input: Parameters<typeof useBriefingPush>[0]) {
  const seen: { state: BriefingPushState; toast: 'accepted' | 'unconfirmed' | undefined }[] = []
  let api: ReturnType<typeof useBriefingPush> | undefined
  function Probe(): null {
    api = useBriefingPush(input)
    seen.push({ state: api.state, toast: api.toast })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(createElement(Probe)) })
  return {
    get api() { return api! },
    get last() { return seen.at(-1)! },
    seen,
    unmount: () => act(() => root.unmount())
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the push state machine', () => {
  it('sends once when the reader taps three times', async () => {
    let resolve: ((value: Awaited<ReturnType<typeof useBriefingPush>> extends never ? never : unknown) => void) | undefined
    const send = vi.fn(() => new Promise((done) => { resolve = done as never }))
    const harness = mount({ edition, send: send as never })
    await act(async () => {
      harness.api.push()
      harness.api.push()
      harness.api.push()
    })
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => { resolve?.({ state: 'sent', delivery: 'sent-accepted' } as never) })
    harness.unmount()
  })

  it('keeps the two success forms apart, and clears each on its own timer', async () => {
    vi.useFakeTimers()
    const accepted = mount({ edition, send: async () => ({ state: 'sent', delivery: 'sent-accepted' }) })
    await act(async () => { accepted.api.push() })
    expect(accepted.last.state).toEqual({ kind: 'sent', receipt: 'accepted' })
    expect(accepted.last.toast).toBe('accepted')
    // Three seconds, then the button is its label again — the success is about this action.
    act(() => { vi.advanceTimersByTime(briefingPushToastMs.accepted) })
    expect(accepted.last.toast).toBeUndefined()
    expect(accepted.last.state).toEqual({ kind: 'idle' })
    accepted.unmount()

    const unconfirmed = mount({ edition, send: async () => ({ state: 'sent', delivery: 'sent-unconfirmed' }) })
    await act(async () => { unconfirmed.api.push() })
    expect(unconfirmed.last.toast).toBe('unconfirmed')
    // Longer, because "no receipt received" is the half a short toast lets a reader miss.
    act(() => { vi.advanceTimersByTime(briefingPushToastMs.accepted) })
    expect(unconfirmed.last.toast).toBe('unconfirmed')
    act(() => { vi.advanceTimersByTime(briefingPushToastMs.unconfirmed - briefingPushToastMs.accepted) })
    expect(unconfirmed.last.toast).toBeUndefined()
    unconfirmed.unmount()
  })

  it('leaves a rejection on screen with its reason, and retrying clears it', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ state: 'failed', reason: 'edition-mismatch' })
      .mockResolvedValueOnce({ state: 'sent', delivery: 'sent-accepted' })
    const harness = mount({ edition, send: send as never })
    await act(async () => { harness.api.push() })
    // A failure is not a toast: it stays, with the sentence a reader can act on.
    expect(harness.last.state).toEqual({ kind: 'failed', reason: 'edition-mismatch' })
    expect(harness.last.toast).toBeUndefined()
    await act(async () => { harness.api.retry() })
    expect(harness.last.state).toEqual({ kind: 'sent', receipt: 'accepted' })
    harness.unmount()
  })

  it('does nothing while the page says why it cannot send', async () => {
    const send = vi.fn()
    const harness = mount({ edition, blocked: 'generating', send: send as never })
    expect(harness.last.state).toEqual({ kind: 'disabled', reason: 'generating' })
    await act(async () => { harness.api.push() })
    expect(send).not.toHaveBeenCalled()
    harness.unmount()
  })
})

describe('the push copy', () => {
  it('never claims delivery, and fills only the holes it is given', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const text = briefingPushText[locale]
      const sentences = [text.sentAccepted, text.sentUnconfirmed, ...Object.values(text.failed), ...Object.values(text.disabled)].join(' ')
      // The one claim we cannot make: the channel accepted it, nothing more.
      expect(sentences).not.toMatch(/已送达|已推送|发送成功|Delivered|Sent successfully/)
      // Two success sentences stay two: the parenthesis is the only difference and it must be there.
      expect(text.sentUnconfirmed).not.toBe(text.sentAccepted)
      expect(text.sentUnconfirmed).toContain('{channel}')
    }
    expect(fillBriefingPush(briefingPushText['zh-CN'].sentAccepted, { channel: 'Telegram · 贾维斯' })).toBe('已交给 Telegram · 贾维斯')
    expect(fillBriefingPush(briefingPushText['en-US'].sentUnconfirmed, { channel: 'Telegram · Jarvis' })).toBe('Handed to Telegram · Jarvis (no receipt received)')
  })

  it('names the button after what it does, and gives one sentence to one situation', () => {
    // 按钮要读者一眼认得出是做啥：「推送到手机」，不是「发布频道」这种要猜的词。
    expect(briefingPushText['zh-CN'].button).toBe('推送到手机')
    expect(briefingPushText['en-US'].button).toBe('Send to phone')
    // 版次不符与「没有同键记录」是同一件事（读者眼前这一版不在通知里），一句就够；
    // 两句分开写，读者会以为是两种毛病。
    expect(briefingPushText['zh-CN'].failed['edition-mismatch']).toBe('这一版还没进通知，先重新生成再看')
    expect(briefingPushText['zh-CN'].failed['record-missing']).toBe(briefingPushText['zh-CN'].failed['edition-mismatch'])
    // 推送暂停是暂时的，别把读者指去改配置。
    expect(briefingPushText['zh-CN'].failed['push-paused']).toContain('自动恢复')
    // 五个拒绝各有自己那句：不许一句通用失败盖住。
    const reasons: readonly BriefingPushFailureKey[] = [
      'channel-not-configured', 'channel-disconnected', 'channel-rate-limited', 'runtime-unavailable', 'push-paused', 'record-missing', 'edition-mismatch', 'surface-invalid'
    ]
    for (const reason of reasons) {
      expect(briefingPushText['zh-CN'].failed[reason].trim().length).toBeGreaterThan(0)
      expect(briefingPushText['zh-CN'].failed[reason]).not.toMatch(/失败$|操作失败/)
    }
  })
})
