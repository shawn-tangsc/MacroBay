import type {
  ChannelDeliveryBlockReason,
  ChannelDeliveryTargetView,
  ChannelManagementSafeView
} from './ChannelManagementContracts'

/**
 * 把一个通道列表折成通知页要的只读投影：能否投递、为什么不能、绑了几个目标。
 *
 * 单独成文件的原因不是「拆好看」：`ChannelManagementService` 已经贴着 500 行硬线，
 * 而这段是纯函数——输入是通道视图、可用适配器类型和启用中的目标，输出是投影，
 * 不碰仓储、不碰副作用，正好可以独立验证。
 *
 * 判序固定：适配器 → 凭据 → 启用态 → 目标。前者不成立时后者没有意义，混着报会
 * 让用户去修一个还不是问题的地方。
 */
export function projectDeliveryTargets(input: {
  channels: readonly ChannelManagementSafeView[]
  supportedTypes: ReadonlySet<ChannelManagementSafeView['type']>
  enabledTargets: ReadonlyArray<{ channelId: string; conversationKind: 'direct' | 'group' | 'channel' }>
}): ChannelDeliveryTargetView[] {
  const targetsByChannel = new Map<string, Array<'direct' | 'group' | 'channel'>>()
  for (const target of input.enabledTargets) {
    const list = targetsByChannel.get(target.channelId) ?? []
    list.push(target.conversationKind)
    targetsByChannel.set(target.channelId, list)
  }

  return input.channels.map((channel) => {
    const targets = targetsByChannel.get(channel.id) ?? []
    const reason: ChannelDeliveryBlockReason | null = !input.supportedTypes.has(channel.type)
      ? 'adapter-not-supported'
      : channel.credential.status !== 'configured'
        ? 'credential-missing'
        : channel.state !== 'runtime-ready'
          ? 'not-enabled'
          : targets.length === 0
            ? 'no-enabled-target'
            : null

    return {
      id: channel.id,
      name: channel.name,
      deliverable: reason === null,
      reason,
      target:
        targets.length === 0
          ? { kind: 'unbound' as const }
          : targets.length === 1
            ? { kind: 'bound' as const, conversationKind: targets[0] }
            : { kind: 'ambiguous' as const, count: targets.length }
    }
  })
}
