import type {
  NotificationPosterEvidence,
  NotificationPosterReasonKind
} from '@platform/notifications/contracts/notificationPosterContracts'

import type { PlatformText } from '../../i18n/platformText'

/**
 * 通知详情里「海报」这一行的判定（#46）。
 *
 * 为什么先落成一个纯函数、再由组件画：四态、分母、计数与 ⓘ 的出现条件是**同一批判据**，
 * 写在 JSX 里就只能靠挂载整屏去测。这里输入「推送那一刻冻结的事实」，输出「读者该看到的那一行」，
 * 用例直接喂形状即可——包括那几条最容易写错的：`poster` 缺席＝没有这件事、`edition === null`
 * ＝这一版没有图（不是失败）、分母读 `enabledImageChannelCount` 而不是数 `channels`。
 *
 * 三条口径来自界面设计 v1.1（`docs-private/05-desktop/ui-audit/2026-11-25-notification-poster-row-v1.md`）：
 * - **queued 归「等回执」**：没发出与发出没回执，对读者都是「没确认到」，不造第五态；
 * - **数字只在 N ≥ 2 时出现**：全部同态写「N 条通道」，部分写「M/N」，单通道不写；
 * - **ⓘ 只有两个出现条件**：≥2 条失败且原因不同（逐通道一行）、或不支持图片的通道（一句）。
 */

export type PosterRowTexts = PlatformText['notifications']['detail']['poster']

export type PosterRowState = 'sent' | 'unconfirmed' | 'failed' | 'noImage'

export type PosterRowModel = {
  state: PosterRowState
  /** 值里紧跟药丸的那一段（`2 条通道` / `1/2`）；单通道或不需要计数时省略。 */
  counts?: string
  /** 值里的原因短词；没有可说的原因时省略（未知码只写计数，不编兜底词）。 */
  reason?: string
  /** ⓘ 面板里的一行行句子；空数组＝没有 ⓘ。 */
  hints: readonly string[]
}

/** 原因档 → 词。闭集由契约给，这里只做「哪一档说哪个词」的映射，不看原始码猜。 */
const REASON_WORD: Record<NotificationPosterReasonKind, keyof PosterRowTexts['reason']> = {
  'render-timeout': 'timeout',
  'render-failed': 'renderFailed',
  'too-large': 'tooLarge',
  'channel-refused': 'channelRefused',
  'channel-unavailable': 'channelUnavailable',
  'image-unavailable': 'imageUnavailable'
}

/** 数字规则：N < 2 不写；全部同态写「N 条通道」；部分写「M/N」。 */
function countsOf(count: number, total: number, text: PosterRowTexts): string | undefined {
  if (total < 2) return undefined
  return count === total ? text.counts.all(total) : text.counts.partial(count, total)
}

export function posterRowModel(
  poster: NotificationPosterEvidence | undefined,
  text: PosterRowTexts
): PosterRowModel | null {
  // ① 没有这份事实：没有推送对象、老记录、或这次启用着的支持图片通道为 0。
  //    没有接收方就没有「发没发」这件事——不出现，不画占位。
  if (poster === undefined) return null
  const total = poster.enabledImageChannelCount
  if (total <= 0) return null

  const hints: string[] = []
  if (poster.unsupportedImageChannelCount > 0) {
    hints.push(text.hint.unsupportedChannels(poster.unsupportedImageChannelCount))
  }

  const imageRows = poster.channels.filter((channel) => channel.supportsImage)
  // N − 真试过的条数＝启用着、这一次没被试过的通道。没试过也是「没发出去」，读者要知道。
  const notAttempted = Math.max(0, total - imageRows.length)

  // ② 只要有一条图片通道行，就**先看通道、不看 `edition`**（界面设计 v1.3）。
  //    理由：手动「发布到手机」会把逐通道结果写回同一条记录，而 `edition` 仍是推送那一刻的冻结值
  //    （`channelImageWiring`），于是会出现「出图超时 + 两条已送达」。照行优先读，读者手机上
  //    有图却被写成「未发送 · 出图超时」。
  if (imageRows.length > 0) {
    const failed = imageRows.filter((channel) => channel.state === 'failed')
    const pending = imageRows.filter((channel) => channel.state === 'queued' || channel.state === 'sent-unconfirmed')

    if (failed.length === 0 && notAttempted === 0) {
      // 覆盖满了、也没有失败：要么全受理，要么还有没确认到的。queued 归「等回执」，不造第五态。
      if (pending.length === 0) {
        const counts = countsOf(total, total, text)
        return { state: 'sent', ...(counts === undefined ? {} : { counts }), hints }
      }
      const counts = countsOf(pending.length, total, text)
      return { state: 'unconfirmed', ...(counts === undefined ? {} : { counts }), hints }
    }

    // 其余一律「未发送」：有失败，或启用着的图片通道这一次没被试过。
    const notSent = failed.length + notAttempted
    const counts = countsOf(notSent, total, text)
    const named = failed.flatMap((channel) => (channel.reasonKind === null || channel.channelName === undefined
      ? []
      : [{ channel, kind: channel.reasonKind }]))
    const kinds = [...new Set(named.map((entry) => entry.kind))]

    let reason: string | undefined
    if (kinds.length >= 2) {
      // 一个词写不下两种失败，硬写就会冤枉其中一个通道——逐通道一行放进 ⓘ。
      // 原因只从图片通道行里收集：不支持图片的那批由 ⓘ 那句「N 个通道不支持图片」覆盖。
      reason = text.reason.multiple
      for (const entry of named) {
        hints.push(text.hint.channelLine(entry.channel.channelName!, text.reason[REASON_WORD[entry.kind]]))
      }
    } else if (kinds.length === 1) {
      reason = text.reason[REASON_WORD[kinds[0]!]]
    } else if (notAttempted > 0) {
      reason = text.reason.channelUnavailable
    }
    // 原因档判不出来（未知码 / 只有名字缺失的失败行）时**只写计数**：不塞原始码，也不编兜底词。

    return {
      state: 'failed',
      ...(counts === undefined ? {} : { counts }),
      ...(reason === undefined ? {} : { reason }),
      hints
    }
  }

  // ③ 一条图片通道行都没有，才看行本身：
  //    `edition === null`＝海报表那一刻没有行，这一版没有图（不是失败）；
  //    行在但没出成→ 未发送 + 出图原因；行是 ready 却一条通道都没试过 → 通道不可用（没试过≠失败码）。
  if (poster.edition === null) return { state: 'noImage', hints }
  const counts = countsOf(total, total, text)
  const reason = poster.edition.status === 'ready'
    ? text.reason.channelUnavailable
    : poster.edition.reasonKind === null ? undefined : text.reason[REASON_WORD[poster.edition.reasonKind]]
  return {
    state: 'failed',
    ...(counts === undefined ? {} : { counts }),
    ...(reason === undefined ? {} : { reason }),
    hints
  }
}