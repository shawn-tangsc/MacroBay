import { join } from 'node:path'

import { app } from 'electron'

import { createEventBusJsonStorage, createEventBusRuntime } from '../runtime/eventBusRuntime'
import type { EventBusRuntime } from '../contracts/eventBusContracts'

let eventBusRuntime: EventBusRuntime | null = null

export function getEventBusRuntime(): EventBusRuntime {
  if (!eventBusRuntime) {
    eventBusRuntime = createEventBusRuntime({
      storage: createEventBusJsonStorage(join(app.getPath('userData'), 'platform', 'event-bus.json'))
    })
  }
  return eventBusRuntime
}

export function resetEventBusRuntimeForTests(): void {
  eventBusRuntime = null
}
