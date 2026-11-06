/**
 * 频道的**只读查询与投影**（目录、列表、审计、策略、会话、运行状态）。
 *
 * 从管理服务里整块搬出来：这一段不写库、不碰运行时、无副作用，是压回 500 行最安全的一刀。
 * 变更与生命周期（启用、自检、凭据、恢复、删除）留在 `ChannelManagementService`。
 */
import type { ChannelManagementRepository } from './ChannelManagementRepository'
import type { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import type { ChannelDeliveryTargetView, ChannelManagementCatalogEntry } from './ChannelManagementContracts'
import { assertBoundedInteger, assertIdentifier } from './ChannelManagementContracts'
import { projectChannelCatalog } from './channelCatalogProjection'
import { projectDeliveryTargets } from './channelDeliveryTargetsProjection'
import { requireExistingChannel } from './channelLookup'
import { listDeliveryAttemptsFor, listDeliveryAuditsFor } from './channelDeliveryQueries'
import { clampAuditLimit, readAuditCursor } from './channelRuntimeAuditPage'

export type ChannelInventoryDeps = {
  repository: ChannelManagementRepository
  registry: Pick<ChannelAdapterAcceptanceRegistry, 'list'>
}

export function createChannelInventory(deps: ChannelInventoryDeps) {
  const requireChannel = (id: unknown): string => requireExistingChannel(deps.repository, id)

  return {
    catalog(): ChannelManagementCatalogEntry[] {
      return projectChannelCatalog(deps.registry.list())
    },

    list() {
      return deps.repository.query.list()
    },

    /** 与旧行为一致：取不到返回 null（IPC 的 get 用它），不抛。 */
    get(id: unknown) {
      return deps.repository.query.get(assertIdentifier(id))
    },

    /**
     * 通知设置页的只读投影：每个通道能否投递、为什么不能、绑了几个目标。
     * 不缓存第二份通道状态——每次调用都读库，与通道页同源。
     */
    listDeliveryTargets(): { channels: ChannelDeliveryTargetView[] } {
      return {
        channels: projectDeliveryTargets({
          channels: deps.repository.query.list(),
          enabledTargets: deps.repository.query.enabledDeliveryTargets()
        })
      }
    },

    listAudits(input: { id: unknown; limit?: unknown; offset?: unknown }) {
      return deps.repository.query.audits(
        requireChannel(input.id),
        assertBoundedInteger(input.limit, 50, 100) || 1,
        assertBoundedInteger(input.offset, 0, 10_000)
      )
    },

    listPolicies(input: { id: unknown; limit?: unknown }) {
      const id = requireChannel(input.id)
      if (deps.repository.channelType(id) === 'wechat') return []
      return deps.repository.query.policies(id, assertBoundedInteger(input.limit, 50, 100) || 1)
    },

    /** 把一条会话登记成投递目标（测试消息自动兜底用）；已有目标时不覆盖。 */
    bindDeliveryTarget(input: { channelId: string; conversationId: string }) {
      const id = requireChannel(input.channelId)
      if (deps.repository.query.hasAnyDeliveryTarget(id)) return
      deps.repository.setTarget(id, input.conversationId, true, new Date().toISOString())
    },

    listConversations(input: { id: unknown; limit?: unknown }) {
      const id = requireChannel(input.id)
      if (deps.repository.channelType(id) === 'wechat') return []
      return deps.repository.query.conversations(id, assertBoundedInteger(input.limit, 50, 100) || 1)
    },

    runtimeStatus(input: { id: unknown }) {
      return deps.repository.query.runtime(requireChannel(input.id))
    },

    listDeliveryAttempts(input: { id: unknown; limit?: unknown; offset?: unknown }) {
      return listDeliveryAttemptsFor(deps.repository, requireChannel(input.id), input)
    },

    listDeliveryAudits(input: { id: unknown; limit?: unknown; offset?: unknown }) {
      return listDeliveryAuditsFor(deps.repository, requireChannel(input.id), input)
    },

    /** 设置页日志面板的「运行异常」：只读、keyset 分页；`limit` 由服务端夹到 200。 */
    listRuntimeAudits(input: { id: unknown; limit?: unknown; cursor?: unknown }) {
      const id = requireChannel(input.id)
      if (deps.repository.channelType(id) === 'wechat') return { rows: [], nextCursor: null }
      return deps.repository.query.runtimeAudits(id, clampAuditLimit(input.limit), readAuditCursor(input.cursor))
    }
  }
}

export type ChannelInventory = ReturnType<typeof createChannelInventory>
