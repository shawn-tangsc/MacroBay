import type { ChannelAdapterKey } from './ChannelManagementPredicates'

export type ChannelAdapterDescriptor = {
  key: ChannelAdapterKey
  /** True only when the runtime adapter itself exists and can be exercised. */
  implemented: boolean
  credentialFields: readonly string[]
  /** 会话名要用的平台名：**唯一来源**，拼接处不许写死 `Telegram` / `QQ` 这类字面量。 */
  displayName: { 'zh-CN': string; 'en-US': string }
}

/**
 * Static capability data. Runtime authorization still comes exclusively from
 * `channel_adapter_support`; this only tells the UI whether collecting credentials makes sense.
 */
export const channelAdapterDescriptors: Record<ChannelAdapterKey, ChannelAdapterDescriptor> = {
  telegram: { key: 'telegram', implemented: true, credentialFields: ['bot_token'], displayName: { 'zh-CN': 'Telegram', 'en-US': 'Telegram' } },
  slack: { key: 'slack', implemented: true, credentialFields: ['bot_token', 'app_token'], displayName: { 'zh-CN': 'Slack', 'en-US': 'Slack' } },
  lark: { key: 'lark', implemented: false, credentialFields: ['app_id', 'app_secret'], displayName: { 'zh-CN': '飞书', 'en-US': 'Lark' } },
  qq: { key: 'qq', implemented: true, credentialFields: ['app_id', 'client_secret'], displayName: { 'zh-CN': 'QQ', 'en-US': 'QQ' } },
  discord: { key: 'discord', implemented: true, credentialFields: ['bot_token'], displayName: { 'zh-CN': 'Discord', 'en-US': 'Discord' } },
  wechat: { key: 'wechat', implemented: false, credentialFields: [], displayName: { 'zh-CN': '微信', 'en-US': 'WeChat' } }
}

export function channelAdapterDescriptor(key: ChannelAdapterKey): ChannelAdapterDescriptor {
  return channelAdapterDescriptors[key]
}
