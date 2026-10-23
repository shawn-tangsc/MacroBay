import { describe, expect, it } from 'vitest'

import { ChannelCommandDispatchService } from './ChannelCommandDispatchService'

describe('ChannelCommandDispatchService', () => {
  it.each(['new', 'compact', 'context', 'cost', 'todos', 'help', 'whoami'] as const)(
    'fails closed for legacy /%s without a C03 execution claim',
    async (command) => {
      const service = new ChannelCommandDispatchService()
      await expect(service.dispatchCommand({
        agentId: 'agent-a', channelId: 'channel-a', chatId: 'legacy-chat', rawText: `/${command}`, command
      })).resolves.toEqual({})
    }
  )
})
