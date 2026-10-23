import type { AgentChannelRuntimeHostFactory, AgentChannelRuntimeHostContext } from '../../ai/agent-platform/channels/channelRuntimeHost'
import type { AgentChannelEntity, AgentChannelType } from '../../ai/agent-platform/schemas/channelSchemas'

export class ChannelRuntimeHostRegistry {
  private readonly factoriesByType = new Map<AgentChannelType, AgentChannelRuntimeHostFactory>()

  register(type: AgentChannelType, factory: AgentChannelRuntimeHostFactory): void {
    if (this.factoriesByType.has(type)) {
      throw new Error(`Channel adapter factory is already registered for type "${type}".`)
    }
    this.factoriesByType.set(type, factory)
  }

  async createHost(
    channel: AgentChannelEntity,
    context: AgentChannelRuntimeHostContext = {}
  ): ReturnType<AgentChannelRuntimeHostFactory> {
    const factory = this.factoriesByType.get(channel.type)
    if (!factory) {
      throw new Error(`Channel adapter factory is not registered for type "${channel.type}".`)
    }
    return factory(cloneChannel(channel), context)
  }
}

function cloneChannel(channel: AgentChannelEntity): AgentChannelEntity {
  return {
    ...channel,
    workspace: { ...channel.workspace },
    config: { ...channel.config },
    activeChatIds: channel.activeChatIds ? [...channel.activeChatIds] : undefined
  } as AgentChannelEntity
}
