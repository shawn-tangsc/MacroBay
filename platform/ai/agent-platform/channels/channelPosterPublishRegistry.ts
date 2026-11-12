import type { NotificationDeliveryState, PushChannelOutcome } from '../../../notifications/contracts/notificationContracts'

/**
 * 「把这一版的海报按通道发出去」的**进程内入口**（海报方案 §5）。
 *
 * 为什么用注册表：投递需要通道列表、投递服务与暂存区，全在主进程装配里；而调用它的是产品 IPC
 * （`publishToPhone`）。产品只读这一个口子，不碰主进程装配，也不需要知道通道表在哪。
 *
 * 三种结果分得开：
 * - `published`：真发了（逐通道结果已经写回同一条记录，返回记录上的 `delivery.push`）；
 * - `no-poster`：这一版没有暂存海报 → 调用方走原来的纯文字路径（既有行为，一字不变）；
 * - `refused`：整条不发（导读超长 / 来源不符 / 图太大），原因码沿用频道的闭集。
 */
export type PosterPublishOutcome =
  | { kind: 'published'; delivery: NotificationDeliveryState; channels: readonly PushChannelOutcome[] }
  | { kind: 'no-poster' }
  | { kind: 'refused'; code: string; detail?: string }

export type PosterPublish = (input: {
  recordId: string
  edition: { date: string; periodId: string; locale: string }
  caption: string
}) => Promise<PosterPublishOutcome>

let configured: PosterPublish | null = null

export function configurePosterPublish(publish: PosterPublish | null): void {
  configured = publish
}

export function getPosterPublish(): PosterPublish | null {
  return configured
}
