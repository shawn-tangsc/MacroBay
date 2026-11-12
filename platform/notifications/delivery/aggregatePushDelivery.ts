import type { NotificationDeliveryPathState, PushChannelOutcome } from '../contracts/notificationContracts'

/**
 * 逐通道结果 → 记录上的聚合四档（多通道方案 §3）。纯函数：不读时钟、不碰存储、不发明第五档。
 *
 * **唯一硬判据**：`sent-accepted` 当且仅当**所有**目标通道都 delivered。有一条没送到，
 * 聚合就不许是 `sent-accepted`——这是「假成功」红线在代码里的可执行形式。
 *
 * 聚合 `reason` 只在**全败**时写：1 成 2 败时抬一个失败原因，读者会以为整条通知都没发出去；
 * 逐通道的原因都在 `channels[]` 里，一条都不丢。
 *
 * 空集合不是成功：0 条目标说明「没有可用通道」（`push-unavailable`），不是「都送到了」。
 */
export function aggregatePushDelivery(
  perChannel: readonly Pick<PushChannelOutcome, 'channelId' | 'state' | 'reason' | 'at'>[]
): { state: NotificationDeliveryPathState; reason?: string } {
  if (perChannel.length === 0) return { state: 'failed', reason: 'push-unavailable' }
  const failed = perChannel.filter((channel) => channel.state === 'failed')
  if (failed.length > 0) {
    // 只有全败时才把某一条的原因抬成整条的原因。
    if (failed.length !== perChannel.length) return { state: 'failed' }
    const reason = failed.find((channel) => channel.reason !== undefined)?.reason
    return reason === undefined ? { state: 'failed' } : { state: 'failed', reason }
  }
  if (perChannel.some((channel) => channel.state === 'sent-unconfirmed')) return { state: 'sent-unconfirmed' }
  if (perChannel.some((channel) => channel.state === 'queued')) return { state: 'queued' }
  return { state: 'sent-accepted' }
}
