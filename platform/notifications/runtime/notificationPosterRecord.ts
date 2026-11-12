import type { PushChannelOutcome } from '../contracts/notificationContracts'
import { aggregatePushDelivery } from '../delivery/aggregatePushDelivery'

/**
 * 把「海报已按通道发完」的逐通道结果写回**同一条**通知记录（海报方案 §5）。
 *
 * 为什么要有它：海报那一路的投递发生在通道层（图 + 导读 / 纯导读），但它记的账必须是通知记录上
 * 的 `delivery.push.channels`——额度按记录算，一条通知永远只有一条记录。
 *
 * 三条与别处一致的口径：
 * - 聚合用**同一个** `aggregatePushDelivery`（海报不另开一套判定）；
 * - 逐通道行原样写进去（含 `kind:'image' | 'text'`，读者能看出哪条降级了）；
 * - `pushCount` 只在真写回时加一，`highestSeverity` 原样保留。
 */
/** 读这条记录上**已经写过的**逐通道海报结果：重发据此跳过已送达的通道。 */
export async function readPosterChannels(deps: {
  recordId: string
  load: () => Promise<{ records: readonly import('../contracts/notificationContracts').NotificationRecord[] } & Record<string, unknown>>
}): Promise<readonly PushChannelOutcome[]> {
  const state = await deps.load()
  const record = state.records.find((candidate) => candidate.id === deps.recordId)
  return record?.delivery.push?.channels ?? []
}

export async function recordPosterOutcomes(deps: {
  recordId: string
  channels: readonly PushChannelOutcome[]
  now: string
  load: () => Promise<{ records: readonly import('../contracts/notificationContracts').NotificationRecord[] } & Record<string, unknown>>
  persist: (state: never) => Promise<void>
  notifyChanged: () => void
}): Promise<{ ok: true; state: ReturnType<typeof aggregatePushDelivery> } | { ok: false }> {
  const state = await deps.load()
  const record = state.records.find((candidate) => candidate.id === deps.recordId)
  if (record === undefined) return { ok: false }
  const aggregate = aggregatePushDelivery(deps.channels)
  const previous = record.delivery.push
  const only = deps.channels.length === 1 ? deps.channels[0] : undefined
  const push = {
    state: aggregate.state,
    ...(aggregate.reason === undefined ? {} : { reason: aggregate.reason }),
    at: deps.now,
    channels: deps.channels,
    pushCount: (previous?.pushCount ?? 0) + 1,
    lastPushedAt: deps.now,
    ...(only?.attemptId === undefined ? {} : { messageId: only.attemptId }),
    ...(previous?.highestSeverity === undefined ? {} : { highestSeverity: previous.highestSeverity })
  }
  const records = state.records.map((candidate) => candidate.id === record.id
    ? { ...candidate, delivery: { ...candidate.delivery, push }, updatedAt: deps.now }
    : candidate)
  await deps.persist({ ...state, records } as never)
  deps.notifyChanged()
  return { ok: true, state: aggregate }
}
