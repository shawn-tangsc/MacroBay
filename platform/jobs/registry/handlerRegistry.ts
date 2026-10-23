import type { JobContext, JobHandler } from '../contracts/jobTypes'

export type HandlerRegistry = {
  register: (handlerId: string, handler: JobHandler) => void
  has: (handlerId: string) => boolean
  invoke: (handlerId: string, payload: unknown, context: JobContext) => Promise<void>
}

export function createHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<string, JobHandler>()

  return {
    register(handlerId, handler) {
      if (handlers.has(handlerId)) {
        throw new Error(`Job handler "${handlerId}" is already registered.`)
      }
      handlers.set(handlerId, handler)
    },
    has(handlerId) {
      return handlers.has(handlerId)
    },
    async invoke(handlerId, payload, context) {
      const handler = handlers.get(handlerId)
      if (!handler) {
        throw new Error(`Unknown job handler "${handlerId}".`)
      }
      await handler(payload, context)
    }
  }
}
