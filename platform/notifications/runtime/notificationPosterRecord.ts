import type { NotificationRecord, PushChannelOutcome } from '../contracts/notificationContracts'
import { aggregatePushDelivery } from '../delivery/aggregatePushDelivery'

/**
 * 把「海报已按通道发完」的逐通道结果写回**同一条**通知记录，但写在**它自己那一格**
 * （`delivery.pushImage`，方案 §12.1）。
 *
 * 为什么不写在 `delivery.push` 里（2026-11-23 的事故）：那一格是**正文**推送的账。
 * 混着写的后果是双向的——① 正文刚推成功，那一格里全是 `sent-accepted`，手动带图来判重时
 * 以为「这张图也发过了」，于是每条通道都被跳过，最后报「整条被拒」，读者一张图都收不到；
 * ② 反过来写还会把正文那格覆盖成海报的结果，正文到底发没发也就说不清了。
 *
 * 三条口径照旧：聚合用**同一个** `aggregatePushDelivery`；逐通道行原样写（含 `kind`）；
 * `pushCount` / `highestSeverity` / `lastPushedAt` **属于正文**，海报一个字都不动它们。
 */
/** 读这条记录上**已经发过的海报**逐通道结果：重发据此跳过已送达的通道。只读海报那格。 */
export async function readPosterChannels(deps: {
  recordId: string
  load: () => Promise<{ records: readonly NotificationRecord[] } & Record<string, unknown>>
}): Promise<readonly PushChannelOutcome[]> {
  const state = await deps.load()
  const record = state.records.find((candidate) => candidate.id === deps.recordId)
  return record?.delivery.pushImage?.channels ?? []
}

export async function recordPosterOutcomes(deps: {
  recordId: string
  channels: readonly PushChannelOutcome[]
  now: string
  load: () => Promise<{ records: readonly NotificationRecord[] } & Record<string, unknown>>
  persist: (state: never) => Promise<void>
  notifyChanged: () => void
}): Promise<{ ok: true; state: ReturnType<typeof aggregatePushDelivery> } | { ok: false }> {
  const state = await deps.load()
  const record = state.records.find((candidate) => candidate.id === deps.recordId)
  if (record === undefined) return { ok: false }
  const aggregate = aggregatePushDelivery(deps.channels)
  const only = deps.channels.length === 1 ? deps.channels[0] : undefined
  const pushImage = {
    state: aggregate.state,
    ...(aggregate.reason === undefined ? {} : { reason: aggregate.reason }),
    at: deps.now,
    channels: deps.channels,
    ...(only?.attemptId === undefined ? {} : { messageId: only.attemptId })
  }
  const records = state.records.map((candidate) => candidate.id === record.id
    // 只换海报那一格：`delivery.push`、`pushCount`、`highestSeverity` 一个字都不动。
    ? { ...candidate, delivery: { ...candidate.delivery, pushImage }, updatedAt: deps.now }
    : candidate)
  await deps.persist({ ...state, records } as never)
  deps.notifyChanged()
  return { ok: true, state: aggregate }
}