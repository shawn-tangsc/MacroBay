/**
 * 「这一条要发给谁」的**唯一实现**（通道方案 §2.3）：通道设置页的目标投影、通知推送端口、
 * 以及设置页的「发一条测试消息」都走这一个函数。
 *
 * 三档判序固定：通道在不在 → 可不可投递（适配器 / 凭据 / 启用）→ 启用且已绑会话的目标是不是正好一个。
 * 多做一份同样规则的副本，两个功能就会在「一个说已绑定、另一个说没绑定」上各说各话。
 *
 * 只读：不缓存、不写库。绑定是瞬时事实，按调用那一刻判。
 */
import type {
  ChannelConversationSafeView,
  ChannelDeliveryTargetView,
  ChannelManagementSafeView
} from './ChannelManagementContracts'

/** 一次取全绑定目标：通道上的会话是个位数，不需要分页。 */
export const CHANNEL_TARGET_CONVERSATION_PAGE = 100

export type ChannelTargetView = {
  list(): readonly ChannelManagementSafeView[]
  listDeliveryTargets(): { channels: readonly ChannelDeliveryTargetView[] }
  listConversations(input: { id: string; limit?: number }): readonly ChannelConversationSafeView[]
  /** 把一条会话登记成投递目标（测试消息自动兜底时回写一次，下次不必再推断）。 */
  bindDeliveryTarget?(input: { channelId: string; conversationId: string }): void
}

export type ChannelTargetResolution =
  | {
    ok: true
    channelId: string
    agentId: string
    conversationId: string
    kind: ChannelConversationSafeView['kind']
    /** 这个目标是「读者显式绑定」还是本轮自动推出来的（自动的那种要回写）。 */
    source: 'bound' | 'fallback'
  }
  /** `not-ready`：通道不存在、凭据缺失或没启用；读者该做的是「去检查通道」。 */
  | { ok: false; reason: 'not-ready' | 'no-target' | 'ambiguous' }

export function resolveDeliveryTarget(
  channels: ChannelTargetView,
  channelId: string,
  options: { allowFallback?: boolean } = {}
): ChannelTargetResolution {
  const channel = channels.list().find((entry) => entry.id === channelId)
  if (channel === undefined) return { ok: false, reason: 'not-ready' }
  const target = channels.listDeliveryTargets().channels.find((entry) => entry.id === channelId)
  if (target === undefined) return { ok: false, reason: 'not-ready' }
  // 目标为空是**目标问题**（读者该去绑定），其余三档是**通道问题**（读者该去检查通道）。
  // 两种原因的下一步动作不同，混成一个词就等于让读者去修一个还不是问题的地方。
  if (!target.deliverable) return { ok: false, reason: target.reason === 'no-enabled-target' ? 'no-target' : 'not-ready' }

  // 唯一目标 = `targetEnabled && hasBoundSession`：停用或没绑会话的历史会话行不算数，
  // 否则一个通道会因为一条废弃绑定永远不发。
  const candidates = channels
    .listConversations({ id: channelId, limit: CHANNEL_TARGET_CONVERSATION_PAGE })
    .filter((conversation) => conversation.targetEnabled && conversation.hasBoundSession)
  if (candidates.length === 1) return { ok: true, channelId, agentId: channel.agentId, conversationId: candidates[0].id, kind: candidates[0].kind, source: 'bound' }
  if (candidates.length > 1) {
    // 通知推送必须唯一，多个绑定时**不猜**；测试消息允许按「最近活跃」兜底（下方）。
    if (!options.allowFallback) return { ok: false, reason: 'ambiguous' }
  }
  if (options.allowFallback) {
    // 读者没有显式绑定时，不让他去绑：跟这条通道说过话的对话就是候选。
    // 查询按 `created_at desc` 返回，第一条即最近创建的那个（入站顺序 = 最近活跃）。
    const bound = channels
      .listConversations({ id: channelId, limit: CHANNEL_TARGET_CONVERSATION_PAGE })
      .filter((conversation) => conversation.hasBoundSession)
    if (bound.length === 0) return { ok: false, reason: 'no-target' }
    return { ok: true, channelId, agentId: channel.agentId, conversationId: bound[0].id, kind: bound[0].kind, source: 'fallback' }
  }
  return { ok: false, reason: 'no-target' }
}
