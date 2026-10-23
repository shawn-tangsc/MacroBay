import type { AgentType } from '../schemas/agentSchemas'
import type { AgentRuntimeDriver } from './runtimeTypes'

export class RuntimeDriverRegistry {
  private readonly drivers = new Map<AgentType, AgentRuntimeDriver>()

  register(agentType: AgentType, driver: AgentRuntimeDriver): void {
    this.drivers.set(agentType, driver)
  }

  get(agentType: AgentType): AgentRuntimeDriver | undefined {
    return this.drivers.get(agentType)
  }

  require(agentType: AgentType): AgentRuntimeDriver {
    const driver = this.get(agentType)
    if (!driver) {
      throw new Error(`Runtime driver "${agentType}" was not registered.`)
    }
    return driver
  }
}
