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
 * 这里把 IPC 换成桩，所以断言的是**判定与句子**，不是网络：三档后果各一条
 * （上限 / 免打扰 / 通道不通），外加「请求根本没到」与「连点只发一次」。
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
  return <div>
    <button data-action="send" onClick={() => void send()} type="button">go</button>
    <button data-action="send-again" onClick={() => { void send(); void send() }} type="button">twice</button>
    <span data-phase={phase.kind} data-message={phase.kind === 'result' ? phase.status.message : ''} data-code={phase.kind === 'result' ? phase.status.reasonCode ?? '' : ''} />
  </div>
}

const phaseNode = (): HTMLElement => host.querySelector('[data-phase]') as HTMLElement
const click = async (selector: string): Promise<void> => {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(selector)!.click()
  })
}

describe('the send state machine', () => {
  it('says the channel took it, with the channel name and the time', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'accepted', delivery: { push: { state: 'sent-accepted' } } })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.phase).toBe('result')
    expect(phaseNode().dataset.message).toBe('已发到 推送通道 · 12:44')
    expect(phaseNode().dataset.code).toBe('')
  })

  it('says the day cap is reached, not that sending failed', async () => {
    act(() => root.render(<Probe send={async () => ({ kind: 'rejected', reason: 'daily-limit-reached' })} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toContain('今天的上限到了')
    // 这不是失败，也没有码要读者看。
    expect(phaseNode().dataset.code).toBe('')
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
    expect(phaseNode().dataset.code).toBe('push-unavailable')
  })

  it('reports a request that never got there, with a code, instead of pretending', async () => {
    act(() => root.render(<Probe send={async () => { throw new Error('invoke-failed') }} />))
    await click('[data-action="send"]')
    expect(phaseNode().dataset.message).toBe('没发出去')
    expect(phaseNode().dataset.code).toBe('invoke-failed')
  })

  it('sends once even when two clicks land in the same frame', async () => {
    const send = vi.fn(async () => ({ kind: 'accepted' }) as AnalysisConclusionSendReceipt)
    act(() => root.render(<Probe send={send} />))
    await click('[data-action="send-again"]')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
