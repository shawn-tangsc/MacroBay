import { describe, expect, it } from 'vitest'

import { AssistantStreamRegistry } from './assistantStreamRegistry'

describe('AssistantStreamRegistry', () => {
  it('rejects late chunks after the topic stream has been aborted', () => {
    const registry = new AssistantStreamRegistry()
    registry.startExecution('topic-1', 'execution-1', 'message-1')

    expect(registry.abortTopic('topic-1')).toEqual({ aborted: true, anchorMessageIds: ['message-1'] })
    expect(registry.isExecutionActive('topic-1', 'execution-1')).toBe(false)
    expect(
      registry.pushChunk('topic-1', {
        topicId: 'topic-1',
        executionId: 'execution-1',
        chunk: { type: 'text-delta', text: 'late chunk' }
      })
    ).toBe(false)
    expect(registry.attach('topic-1').bufferedChunks).toEqual([])
  })
})
