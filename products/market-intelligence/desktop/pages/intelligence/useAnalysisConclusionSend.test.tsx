// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisConclusionSendReceipt } from '../../shared/ipc/analysisConclusionSendClient'
import { analysisConclusionSendText } from './analysisConclusionSendText'
import { useAnalysisConclusionSend } from './useAnalysisConclusionSend'

/**
 * 状态机：回执 → 说明行那一句，以及「发一次只发一次」。
 *
 * 这里把 IPC 换成桩，所以断言的是**判定与句子**，不是网络：三条多通道计数（全成 / 部分 / 一条没到）、
 * 免打扰、上限、通道不通，外加「请求根本没到」与「连点只发一次」。
 */
const text = analysisConclusionSendText('zh-CN')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Probe(props: { send: (runId: string) => Promise<AnalysisConclusionSendReceipt>; analysisRunId?: string }): React.ReactElement {
  const { phase, send } = useAnalysisConclusionSend({ text, analysisRunId: props.analysisRunId ?? 'mi-ar-1', send: props.send, formatNow: () => '12:44' })
  const channels = phase.kind === 'result' ? phase.status.channels ?? [] : []
  return <div>
    <button data-action="send" onClick={() => void send()} type="button">go</button>
    <button data-action="send-again" onClick={() => { void send(); void send() }} type="button">twice</button>
    <span data-phase={phase.kind} data-message={phase.kind === 'result' ? phase.status.message : ''} data-channels={channels.map((row) => `${row.name}|${row.detail}`).join(';')} />
  </div>
}

const phaseNode = (): HTMLElement => host.querySelector('[data-phase]') as HTMLElement
const click = async (selector: string): Promise<void> => {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(selector)!.click()
  })
}

describe('the send state machine', () => {
  it('reports how many channels received it, without naming any of them in the body', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'accepted', delivery: { push: {
      state: 'sent-accepted',
      channels: [
        { channelName: 'Telegram · 观潮', state: 'sent-accepted' },
        { channelName: '飞书 · 团队', state: 'sent-accepted' }
      ]
    } } })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.phase).toBe('result')
    expect(phaseNode().dataset.message).toBe('2 条通道都收到了')
    // 通道名只进 ⓘ 的逐行说明，不出现正文。
    expect(phaseNode().dataset.message).not.toContain('Telegram')
    expect(phaseNode().dataset.channels).toBe('Telegram · 观潮|收到了;飞书 · 团队|收到了')
  })

  it('counts a partial result and keeps the failed reason in human words', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'accepted', delivery: { push: {
      state: 'failed',
      channels: [
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'failed', reason: 'channel-rejected' }
      ]
    } } })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toBe('1 条通道收到，1 条没到')
    expect(phaseNode().dataset.channels).toBe('Telegram|收到了;飞书|通道没接这次请求')
  })

  it('says the day cap is reached, not that sending failed', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'rejected', reason: 'daily-limit-reached' })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toContain('今天的上限到了')
    expect(phaseNode().dataset.channels).toBe('')
  })

  it('says quiet hours filtered the phone leg and that nothing is resent later', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'accepted', delivery: { suppressed: [{ level: 'channel', reason: 'quiet-hours' }] } })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toContain('不会自动补发')
    expect(phaseNode().dataset.message).toContain('关掉免打扰再点一次')
  })

  it('points at the channel page when no channel can take it', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'accepted', delivery: { push: { state: 'failed', reason: 'push-unavailable' } } })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toBe('没发到手机：还没有可用的通道，去「频道」启用一条')
  })

  it('reports a request that never got there, with a code, instead of pretending', async () => {
    act(() => root.render(<Probe send={async () => { throw new Error('invoke-failed') }} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toBe('没发出去')
    // 原因码不上屏：这一行只说结果，码留在主进程的诊断里。
    expect(phaseNode().dataset.message).not.toContain('invoke-failed')
  })

  it('sends once even when two clicks land in the same frame', async () => {
    const send = vi.fn(async () => ({ kind: 'accepted' }) as AnalysisConclusionSendReceipt)
    act(() => root.render(<Probe send={send} />))
    await click('[data-action="send-again"]')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
