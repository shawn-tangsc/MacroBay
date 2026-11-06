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
 * 判序固定：凭据 → 启用态 → 目标。前者不成立时后者没有意义，混着报会
 * 让用户去修一个还不是问题的地方。
 *
 * **不把「适配器是否 supported」当判据**（用户 2026-11-04 的教训）：`supported` 只决定
 * 「平台是否对外声明支持」，不决定这位用户能不能用。拿它挡投递，会让一条**已经在跑、凭据可用、
 * 目标已绑**的通道在通知页里显示「适配器不支持」，手机推送永远选不到它。
 */
export function projectDeliveryTargets(input: {
  channels: readonly ChannelManagementSafeView[]
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
    // `adapter-not-supported` 仍是闭集里的一个值（历史数据与界面文案都在用），但这里**不再产出**：
    // 「能不能投递」只看这条通道此刻是否真的可用，不看平台有没有对外声明支持。
    const reason: ChannelDeliveryBlockReason | null = channel.credential.status !== 'configured'
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
