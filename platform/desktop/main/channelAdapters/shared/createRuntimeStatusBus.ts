import type { AgentChannelRuntimeStatusUpdate } from '../../../../ai/agent-platform/channels/channelRuntimeHost'

export type RuntimeStatusBus = {
  subscribe: (listener: (status: AgentChannelRuntimeStatusUpdate) => void) => () => void
  publish: (status: AgentChannelRuntimeStatusUpdate) => void
}

export function createRuntimeStatusBus(): RuntimeStatusBus {
  const listeners = new Set<(status: AgentChannelRuntimeStatusUpdate) => void>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish(status) {
      for (const listener of listeners) {
        listener(status)
      }
    }
  }
}
