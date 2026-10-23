import { describe, expect, it } from 'vitest'

import { ChannelMessageDispatchService } from './ChannelMessageDispatchService'

describe('ChannelMessageDispatchService', () => {
  it('rejects a legacy batch before it can run an Agent or send externally', async () => {
    const dispatch = new ChannelMessageDispatchService()
    await expect(dispatch.dispatchFlushedBatch({
      agentId: 'agent-a', channelId: 'channel-a', chatId: 'legacy-chat', sessionId: 'session-a', text: 'inbound', rawText: 'inbound',
      messageCount: 1, startedAt: 0, flushedAt: 1, security: { cleanedText: 'inbound', suspiciousPatternNames: [], chatId: 'chat-a', userId: 'user-a', userName: 'User', channelType: 'telegram' },
      sanitizeOutput: (text) => ({ text, redacted: false })
    })).resolves.toBeUndefined()
  })
})
