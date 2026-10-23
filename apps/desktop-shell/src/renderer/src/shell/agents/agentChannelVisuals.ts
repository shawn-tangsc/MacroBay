import type { AgentChannelEntity, AgentChannelType } from '@platform/ai/agent-platform/schemas/channelSchemas'

export type AgentChannelIconName = 'telegram' | 'feishu' | 'qq' | 'wechat' | 'discord' | 'slack'

const CHANNEL_ICON_NAMES: Record<AgentChannelType, AgentChannelIconName> = {
  telegram: 'telegram',
  feishu: 'feishu',
  qq: 'qq',
  wechat: 'wechat',
  discord: 'discord',
  slack: 'slack'
}

const CHANNEL_ICON_URLS: Record<AgentChannelIconName, string> = {
  telegram: new URL('../../assets/icons/channels/telegram.png', import.meta.url).href,
  feishu: new URL('../../assets/icons/channels/feishu.jpeg', import.meta.url).href,
  qq: new URL('../../assets/icons/channels/qq.svg', import.meta.url).href,
  wechat: new URL('../../assets/icons/channels/wechat.png', import.meta.url).href,
  discord: new URL('../../assets/icons/channels/discord.svg', import.meta.url).href,
  slack: new URL('../../assets/icons/channels/slack.svg', import.meta.url).href
}

export function getAgentChannelTypeIconName(channelType: string | undefined): AgentChannelIconName | undefined {
  if (!channelType) return undefined
  if (!(channelType in CHANNEL_ICON_NAMES)) return undefined
  return CHANNEL_ICON_NAMES[channelType as AgentChannelType]
}

export function getAgentChannelTypeIconUrl(channelType: string | undefined): string | undefined {
  const iconName = getAgentChannelTypeIconName(channelType)
  return iconName ? CHANNEL_ICON_URLS[iconName] : undefined
}

export function getSessionChannelTypeBySessionId(
  channels: readonly AgentChannelEntity[]
): Record<string, AgentChannelType> {
  const next: Record<string, AgentChannelType> = {}
  for (const channel of channels) {
    if (!channel.isActive || !channel.sessionId) continue
    next[channel.sessionId] = channel.type
  }
  return next
}
