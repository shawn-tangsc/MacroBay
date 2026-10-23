import type { AgentChannelRuntimeHostFactory } from '../../../ai/agent-platform/channels/channelRuntimeHost'
import type { AgentChannelType } from '../../../ai/agent-platform/schemas/channelSchemas'
import { createDiscordChannelHost } from './discord/createDiscordChannelHost'
import { createFeishuChannelHost } from './feishu/createFeishuChannelHost'
import { createQqChannelHost } from './qq/createQqChannelHost'
import { createSlackChannelHost } from './slack/createSlackChannelHost'
import { createTelegramChannelHost } from './telegram/createTelegramChannelHost'

type RegisterChannelAdaptersDependencies = {
  register: (type: AgentChannelType, factory: AgentChannelRuntimeHostFactory) => void
}

export function registerChannelAdapters(deps: RegisterChannelAdaptersDependencies): void {
  deps.register('telegram', createTelegramChannelHost as AgentChannelRuntimeHostFactory)
  deps.register('slack', createSlackChannelHost as AgentChannelRuntimeHostFactory)
  deps.register('feishu', createFeishuChannelHost as AgentChannelRuntimeHostFactory)
  deps.register('qq', createQqChannelHost as AgentChannelRuntimeHostFactory)
  deps.register('discord', createDiscordChannelHost as AgentChannelRuntimeHostFactory)
}
