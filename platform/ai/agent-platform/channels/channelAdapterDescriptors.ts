import type { ChannelAdapterKey } from './ChannelManagementPredicates'

export type ChannelAdapterDescriptor = {
  key: ChannelAdapterKey
  /** True only when the runtime adapter itself exists and can be exercised. */
  implemented: boolean
  credentialFields: readonly string[]
}

/**
 * Static capability data. Runtime authorization still comes exclusively from
 * `channel_adapter_support`; this only tells the UI whether collecting credentials makes sense.
 */
export const channelAdapterDescriptors: Record<ChannelAdapterKey, ChannelAdapterDescriptor> = {
  telegram: { key: 'telegram', implemented: true, credentialFields: ['bot_token'] },
  slack: { key: 'slack', implemented: true, credentialFields: ['bot_token', 'app_token'] },
  lark: { key: 'lark', implemented: false, credentialFields: ['app_id', 'app_secret'] },
  qq: { key: 'qq', implemented: false, credentialFields: ['app_id', 'client_secret'] },
  discord: { key: 'discord', implemented: false, credentialFields: ['bot_token'] },
  wechat: { key: 'wechat', implemented: false, credentialFields: [] }
}

export function channelAdapterDescriptor(key: ChannelAdapterKey): ChannelAdapterDescriptor {
  return channelAdapterDescriptors[key]
}
