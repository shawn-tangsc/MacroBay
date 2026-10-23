import type { ChannelCommandDispatchResult, ChannelCommandRequest } from './channelSlashCommands'

// Slash commands originated on the pre-C03 host path. They lack an exact inbound execution
// claim and a durable conversation binding, so they cannot mutate legacy state or send output.
export class ChannelCommandDispatchService {
  async dispatchCommand(_request: ChannelCommandRequest): Promise<ChannelCommandDispatchResult> {
    return {}
  }
}
