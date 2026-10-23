import type { AgentPermissionMode } from './agentSchemas'
import type { AgentSessionWorkspaceSource } from './workspaceSchemas'

export const agentChannelTypes = ['telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack'] as const
export type AgentChannelType = (typeof agentChannelTypes)[number]

export const feishuDomains = ['feishu', 'lark'] as const
export type FeishuDomain = (typeof feishuDomains)[number]

export type TelegramAgentChannelConfig = {
  bot_token: string
  allowed_chat_ids?: string[]
}

export type FeishuAgentChannelConfig = {
  app_id: string
  app_secret: string
  encrypt_key: string
  verification_token: string
  allowed_chat_ids?: string[]
  domain: FeishuDomain
}

export type QQAgentChannelConfig = {
  app_id: string
  client_secret: string
  allowed_chat_ids?: string[]
}

export type WeChatAgentChannelConfig = {
  token_path: string
  allowed_chat_ids?: string[]
}

export type DiscordAgentChannelConfig = {
  bot_token: string
  allowed_channel_ids?: string[]
}

export type SlackAgentChannelConfig = {
  bot_token: string
  app_token: string
  allowed_channel_ids?: string[]
}

export type AgentChannelConfig =
  | TelegramAgentChannelConfig
  | FeishuAgentChannelConfig
  | QQAgentChannelConfig
  | WeChatAgentChannelConfig
  | DiscordAgentChannelConfig
  | SlackAgentChannelConfig

type AgentChannelBase<TType extends AgentChannelType, TConfig extends AgentChannelConfig> = {
  id: string
  type: TType
  name: string
  agentId?: string | null
  sessionId?: string | null
  workspace: AgentSessionWorkspaceSource
  config: TConfig
  isActive: boolean
  activeChatIds?: string[]
  permissionMode?: AgentPermissionMode | null
  createdAt: string
  updatedAt: string
}

export type TelegramAgentChannelEntity = AgentChannelBase<'telegram', TelegramAgentChannelConfig>
export type FeishuAgentChannelEntity = AgentChannelBase<'feishu', FeishuAgentChannelConfig>
export type QQAgentChannelEntity = AgentChannelBase<'qq', QQAgentChannelConfig>
export type WeChatAgentChannelEntity = AgentChannelBase<'wechat', WeChatAgentChannelConfig>
export type DiscordAgentChannelEntity = AgentChannelBase<'discord', DiscordAgentChannelConfig>
export type SlackAgentChannelEntity = AgentChannelBase<'slack', SlackAgentChannelConfig>

export type AgentChannelEntity =
  | TelegramAgentChannelEntity
  | FeishuAgentChannelEntity
  | QQAgentChannelEntity
  | WeChatAgentChannelEntity
  | DiscordAgentChannelEntity
  | SlackAgentChannelEntity

export type CreateAgentChannelDto = Omit<AgentChannelEntity, 'id' | 'createdAt' | 'updatedAt'>

export type UpdateAgentChannelDto = {
  name?: string
  agentId?: string | null
  sessionId?: string | null
  workspace?: AgentSessionWorkspaceSource
  config?: AgentChannelConfig
  isActive?: boolean
  activeChatIds?: string[]
  permissionMode?: AgentPermissionMode | null
}

export type AgentChannelListQuery = {
  agentId?: string
  type?: AgentChannelType
}
