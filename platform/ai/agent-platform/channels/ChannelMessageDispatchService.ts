import type { ChannelFlushedBatch } from './ChannelMessageRuntimeService'

// C03 legacy batches contain neither a durable execution claim nor a conversation binding.
// They are retained only as a compatibility fixture and must not execute an Agent or send.
export class ChannelMessageDispatchService {
  async dispatchFlushedBatch(_batch: ChannelFlushedBatch): Promise<void> {
    return
  }
}
