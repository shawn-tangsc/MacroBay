import { describe, expect, it } from 'vitest'

import {
  abandonSend,
  acceptsStatusTerminal,
  beginSend,
  idleAssistantSendFence,
  recordSendExecutions,
  settleSend
} from './assistantSendFence'

describe('assistant send fence (PLAT-64)', () => {
  it('settles a brand-new topic from a terminal event that arrives before streamOpen returns ids', () => {
    const fence = beginSend('new-topic', true)

    expect(settleSend(fence, 'new-topic', 'first-execution')).toEqual({
      fence: idleAssistantSendFence,
      settled: true
    })
  })

  it('does not settle an existing topic from a prior execution terminal before the open returns', () => {
    const fence = beginSend('existing', false)

    // 上一条执行的 done/error 先到：不能解锁，只把执行 id 记下等对账。
    const early = settleSend(fence, 'existing', 'first-execution')
    expect(early.settled).toBe(false)
    expect(early.fence.earlyTerminalExecutionIds).toEqual(['first-execution'])

    // streamOpen 返回的是本次执行 ⇒ 那条旧 id 不属于本次，仍不解锁。
    const recorded = recordSendExecutions(early.fence, 'existing', ['second-execution'])
    expect(recorded.settled).toBe(false)

    // 本次执行的终止事件才解锁；不属于本次的迟到事件继续被忽略。
    const foreign = settleSend(recorded.fence, 'existing', 'first-execution')
    expect(foreign.settled).toBe(false)
    expect(settleSend(foreign.fence, 'existing', 'second-execution').settled).toBe(true)
  })

  it('settles after the open returns ids when the early terminal really was this execution', () => {
    const early = settleSend(beginSend('existing', false), 'existing', 'first-execution')
    expect(early.settled).toBe(false)

    const recorded = recordSendExecutions(early.fence, 'existing', ['first-execution'])
    expect(recorded.settled).toBe(true)
  })

  it('ignores a terminal event for another topic', () => {
    const fence = beginSend('topic-a', true)

    expect(settleSend(fence, 'topic-b', 'execution')).toEqual({ fence, settled: false })
    expect(recordSendExecutions(fence, 'topic-b', ['execution'])).toEqual({ fence, settled: false })
  })

  it('gates topic-level status snapshots until the open returns ids for an existing topic', () => {
    const pending = beginSend('existing', false)
    expect(acceptsStatusTerminal(pending, 'existing')).toBe(false)

    const recorded = recordSendExecutions(pending, 'existing', ['execution-1'])
    expect(acceptsStatusTerminal(recorded.fence, 'existing')).toBe(true)
    // 新建话题的首发可以在 id 回来之前用话题级终态结算（首条消息常在重绑前结束）。
    expect(acceptsStatusTerminal(beginSend('new-topic', true), 'new-topic')).toBe(true)
    // 没有发送中的记录时，状态快照照常反映话题本身。
    expect(acceptsStatusTerminal(idleAssistantSendFence, 'existing')).toBe(true)
  })

  it('drops the fence when the send is abandoned, and keeps a fence for another topic', () => {
    const fence = beginSend('topic-a', false)

    expect(abandonSend(fence, 'topic-b')).toBe(fence)
    expect(abandonSend(fence, 'topic-a')).toEqual(idleAssistantSendFence)
    expect(abandonSend(fence)).toEqual(idleAssistantSendFence)
  })
})
