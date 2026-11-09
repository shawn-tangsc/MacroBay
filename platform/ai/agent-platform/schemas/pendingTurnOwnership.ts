import type { AgentSessionMessageEntity } from './sessionSchemas'

/**
 * 崩溃收尾的**归属口径**：这条 `pending` 是哪一次主进程启动写的。
 *
 * 这是唯一的判定实现——写库时补哪个批次、收尾时收哪些行，都从这里取，调用点不许各写一份。
 * 生成批次标识在宿主（`platform/desktop/main/processBootId.ts`，进程启动时一次）；这里只做判定，
 * 平台层不反向依赖宿主。
 */
export type PendingTurnOwnership = Readonly<{ ownerBootId?: string }>

/** 写 pending 时捎上的归属字段；没有批次就什么都不带（由仓储兜底补本批次）。 */
export function pendingOwnerFields(ownerBootId: string | undefined): PendingTurnOwnership {
  return ownerBootId ? { ownerBootId } : {}
}

/**
 * 一条消息写库时的 `ownerBootId`：**进 pending 的那一次**写，pending 生命周期内不变。
 *
 * 写 pending 的落点不止一处（运行时、仓储），补写放在这一层，新调用点不会漏；复用同一条
 * 消息重新进入 pending 时覆盖成当前批次（值幂等，不需要额外去重）。非 pending 不带 owner。
 */
export function resolveMessageOwnerBootId(
  entity: Pick<AgentSessionMessageEntity, 'status' | 'ownerBootId'>,
  bootId: string | undefined
): string | null {
  if (entity.ownerBootId) return entity.ownerBootId
  if (entity.status !== 'pending') return null
  return bootId ?? null
}

/**
 * 不是本批次留下的 pending（含字段缺失的老行）＝ 上一个进程的东西，该收。
 * 本批次的一条都不许动：那是本进程正在跑的回合。
 */
export function isAbandonedPendingMessage(
  message: Pick<AgentSessionMessageEntity, 'status' | 'ownerBootId'>,
  ownerBootId: string
): boolean {
  return message.status === 'pending' && message.ownerBootId !== ownerBootId
}
