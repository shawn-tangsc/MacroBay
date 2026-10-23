import { describe, expect, it } from 'vitest'

import {
  classifyTopicStreamTurn,
  createIdleTopicStreamSnapshot,
  isTopicStreamTerminal,
  resolveTopicStreamStatus
} from '../runtime/assistantStreamState'

describe('assistantStreamState', () => {
  it('starts idle and classifies live versus terminal turns', () => {
    const idle = createIdleTopicStreamSnapshot('topic-1')
    expect(idle.status).toBe('done')
    expect(idle.activeExecutions).toEqual([])
    expect(classifyTopicStreamTurn(idle)).toEqual({
      isStreamLive: false,
      isTurnActive: false,
      isAwaitingApproval: false,
      isTerminal: true
    })
  })

  it('resolves streaming, aborted, error, and awaiting-approval statuses', () => {
    expect(
      resolveTopicStreamStatus({
        activeExecutions: [{ executionId: 'e1', anchorMessageId: 'a1' }],
        awaitingApprovalAnchors: [],
        hasError: false,
        aborted: false
      })
    ).toBe('streaming')

    expect(
      resolveTopicStreamStatus({
        activeExecutions: [],
        awaitingApprovalAnchors: [{ executionId: 'e1', anchorMessageId: 'a1' }],
        hasError: false,
        aborted: false
      })
    ).toBe('awaiting-approval')

    expect(
      resolveTopicStreamStatus({
        activeExecutions: [],
        awaitingApprovalAnchors: [],
        hasError: true,
        aborted: false
      })
    ).toBe('error')

    expect(
      resolveTopicStreamStatus({
        activeExecutions: [],
        awaitingApprovalAnchors: [],
        hasError: false,
        aborted: true
      })
    ).toBe('aborted')

    expect(isTopicStreamTerminal('done')).toBe(true)
    expect(isTopicStreamTerminal('streaming')).toBe(false)
  })
})
