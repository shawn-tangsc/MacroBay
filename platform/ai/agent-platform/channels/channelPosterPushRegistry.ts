import type { ChannelDeliveryResult, ChannelImageDeliveryRequest } from './ChannelDeliveryContracts'

/**
 * 简报海报**随推送**发出所需的两个开关（方案 §12.1）：按记录里的 hash 取图 + 图片投递入口。
 *
 * 为什么用注册表：这两个东西都只在主进程装配里有（通道投影、投递服务、海报读入口），
 * 而用它们的是**通知运行时的推送执行器**（平台侧）。让 `app.ts` 多传一个端口等于让受保护接缝再长一截，
 * 所以照 `channelPosterPublishRegistry` 的既有做法，由通道装配注册、推送执行器调用时取。
 *
 * 没注册就是「这一版只发正文」——那是这条链路的回退点，不是错误。
 */
export type ChannelPosterPushSource = {
  /** 按**记录里的**内容 hash 取图；来源与读盘规则在 `channelImageSource` 一处。 */
  resolve: (contentHash: string) => Promise<
    | { ok: true; mime: string; bytes: Uint8Array }
    | { ok: false; code: 'delivery-image-unavailable' | 'delivery-image-source-not-allowed'; detail: string }
  >
  deliverImage: (request: Omit<ChannelImageDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult>
}

let configured: ChannelPosterPushSource | null = null

export function configureChannelPosterPushSource(source: ChannelPosterPushSource | null): void {
  configured = source
}

export function getChannelPosterPushSource(): ChannelPosterPushSource | null {
  return configured
}