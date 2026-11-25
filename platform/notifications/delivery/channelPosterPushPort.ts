import {
  channelPosterPushSourceId,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { resolveDeliveryTarget } from '../../ai/agent-platform/channels/channelDeliveryTargetResolution'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { PushAttemptResult } from './pushDeliveryState'
import type { ChannelPushPortDeps, ChannelPushTarget } from './channelPushPort'

/**
 * 简报海报**随推送**发出的端口（方案 §12.1/§12.4）。
 *
 * 与正文那条端口分开的理由：形态不同（图无 caption）、幂等键不同（带内容 hash）、失败不影响正文的账。
 * 三条纪律照抄正文那条，不另立一套：
 * - 只发到**被点名的**目标（谁可用、谁在退避由 runtime 判，端口不重判）；
 * - 串行、按传进来的顺序；单通道异常只记它自己失败；
 * - 目标判定读**唯一实现** `resolveDeliveryTarget`——两个功能各判一次，迟早一个说绑了一个说没绑。
 *
 * 图**只读一次**：N 条通道复用同一份字节。来源读不出来就一条都不发，且**码要分开**：
 * 「这一版没有海报」与「图在但读不出来」是两件事。
 *
 * 429：按上游 `retryAfterMs` **等一次再发**，超过上限就不等（等完再撞一次 429，只会被误记成通道坏了）。
 */
export type ChannelPosterPushAttempt = { channelId: string; channelName: string; result: PushAttemptResult }

export type ChannelPosterPushHook = (
  record: NotificationRecord,
  targets: readonly ChannelPushTarget[]
) => Promise<readonly ChannelPosterPushAttempt[]>

/** 上游说的「等多久」上限：超过它就不重发，直接记 failed（方案 §12.4 定 30s）。 */
export const CHANNEL_POSTER_RETRY_WAIT_CAP_MS = 30_000

export type ChannelPosterPushPortDeps = {
  /** 与正文端口同一份通道投影（`ChannelPushPortDeps['channels']`），不缓存第二份。 */
  channels: ChannelPushPortDeps['channels']
  /** 按**记录里的**内容 hash 取图；来源与读盘规则在 `channelImageSource` 一处。 */
  resolvePoster: (contentHash: string) => Promise<
    | { ok: true; mime: string; bytes: Uint8Array }
    | { ok: false; code: 'delivery-image-unavailable' | 'delivery-image-source-not-allowed'; detail: string }
  >
  deliverImage: (request: Omit<ChannelImageDeliveryRequest, 'conversationId'>) => Promise<ChannelDeliveryResult>
  /** 等待实现（测试注入，生产用真计时器）：`retry_after` 是上游说的，不是我们编的。 */
  wait?: (ms: number) => Promise<void>
}

export function createChannelPosterPushPort(deps: ChannelPosterPushPortDeps): ChannelPosterPushHook {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))

  return async function pushPoster(record, targets) {
    const contentHash = record.editionPoster?.contentHash
    // 记录没带海报 = 这一版没有图（出图失败/超时/旧版次）：一次图请求都不发，也不写 `pushImage`。
    if (contentHash === undefined) return []
    // 只读一次：N 条通道复用同一份字节；中途删文件不许变成「部分成功」。
    const poster = await deps.resolvePoster(contentHash)
    const attempts: ChannelPosterPushAttempt[] = []
    for (const target of targets) {
      attempts.push({ channelId: target.channelId, channelName: target.channelName, result: await sendTo(target, contentHash) })
    }
    return attempts

    async function sendTo(target: ChannelPushTarget, hash: string): Promise<PushAttemptResult> {
      if (!poster.ok) {
        // 来源码原样交上去（`delivery-image-source-not-allowed` / `delivery-image-unavailable`），
        // 不压成一句「通道拒收」——那样「这一版没图」与「图读不出来」在记录上就分不开了。
        return { ok: false, reason: poster.code }
      }
      try {
        const resolved = resolveDeliveryTarget(deps.channels, target.channelId)
        if (!resolved.ok) {
          return { ok: false, reason: resolved.reason === 'no-target' ? 'delivery-no-target-bound' : 'channel-rejected' }
        }
        const request: Omit<ChannelImageDeliveryRequest, 'conversationId'> = {
          channelId: resolved.channelId,
          agentId: resolved.agentId,
          source: 'notification',
          // 幂等键带**内容版本**：同一张图重投是同一键（幂等），换一张图就是新键（新尝试）。
          sourceId: channelPosterPushSourceId(record.id, hash),
          image: { mime: poster.mime, bytes: poster.bytes },
          // 图**不带 caption**（方案 §12.1）：正文那一条已经说完了话，图是同一内容的展示形态。
          caption: ''
        }
        let result = await deps.deliverImage(request)
        const retryMs = retryWaitMs(result)
        if (retryMs !== null) {
          await wait(retryMs)
          result = await deps.deliverImage(request)
        }
        return mapImageResult(result)
      } catch {
        // 端口不许把异常抛回推送路径：失败是记录上的证据，不是一条丢掉的通知。
        return { ok: false, reason: 'channel-rejected' }
      }
    }
  }
}

/**
 * 这一次要不要内联重发，等多久。
 *
 * 只有上游**明确说了**等多久才等：没有 `retryAfterMs` 就不重发——我们编一个退避数字，
 * 上游还在限流时只会换来第二次 429，然后被记成「通道坏了」。
 * 超过上限也不等：等 2 分钟会把这轮推送拖住，而读者要的是正文（正文早就到了）。
 */
function retryWaitMs(result: ChannelDeliveryResult): number | null {
  if (result.status !== 'failed' || result.errorCode !== 'delivery-rate-limited') return null
  const retryAfterMs = result.retryAfterMs
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return null
  return retryAfterMs > CHANNEL_POSTER_RETRY_WAIT_CAP_MS ? null : retryAfterMs
}

/** 与正文那条同一个映射口径，但**保留图片自己的原因码**（审计要看得出是哪一类没发出去）。 */
function mapImageResult(result: ChannelDeliveryResult): PushAttemptResult {
  if (result.status === 'delivered') {
    return { ok: true, ...(result.attemptId === null ? {} : { messageId: result.attemptId }) }
  }
  if (result.status === 'unknown-after-send') return { ok: false, reason: 'unknown-after-send' }
  return { ok: false, reason: result.errorCode ?? 'channel-rejected' }
}