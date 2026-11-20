import { useCallback, useRef, useState } from 'react'

import type { BriefingPublishPreparation, BriefingPosterBytes } from './briefingPosterPublish'
import {
  redeliverBriefingPush,
  type BriefingPushChannelResult,
  type BriefingPushEdition,
  type BriefingPushFailure
} from './dailyBriefingPushClient'

/**
 * The button's state machine, kept out of the page and out of the component.
 *
 * 海报之后这里多了「发之前先判一次」这一档（海报方案 §5）：
 * - **导读超长** → 整条不发、不截断，给读者两个动作（只发文字 / 缩短导读）；
 * - **海报渲不出来** → 一次 IPC 都不发，只报一句人话 + 重试；
 * - **图太大** → 同上，并说清多大；
 * - 拿到字节才发；**只发文字**是读者自己选的那条路（不带图），不是失败降级。
 *
 * 其余照旧：发送中不接受第二次点击（慢网络最容易被连点），失败留在屏幕上带原因与重试。
 */

export type BriefingPushState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'sending' }>
  /** 发布动作做完了：聚合档 + 逐通道行（多通道时逐条给结果）。 */
  | Readonly<{
      kind: 'result'
      delivery: 'sent-accepted' | 'sent-unconfirmed' | 'failed' | 'queued'
      deliveryReason?: string
      channels?: readonly BriefingPushChannelResult[]
      /** 这一次尝试的形态：带图发的还是只发文字（结果句的形态前缀读它）。 */
      attempt: 'poster' | 'text'
    }>
  | Readonly<{ kind: 'failed'; reason: BriefingPushFailure }>
  /** 导读超长：整条不发，给两个动作。 */
  | Readonly<{ kind: 'caption-too-long'; chars: number }>
  /** 海报字节超限：整条不发，说清多大。 */
  | Readonly<{ kind: 'poster-too-large'; byteLength: number }>
  | Readonly<{ kind: 'disabled'; reason: BriefingPushDisabledReason }>

export type BriefingPushDisabledReason = 'generating' | 'no-edition' | 'missing-locale' | 'capability'

export function useBriefingPush(input: Readonly<{
  edition: BriefingPushEdition | undefined
  /** Stated by the page, which knows why there is no edition or why this build cannot send. */
  blocked?: BriefingPushDisabledReason
  send?: (edition: BriefingPushEdition, poster?: Readonly<{ bytes: Uint8Array; mime: string }>) => Promise<Awaited<ReturnType<typeof redeliverBriefingPush>>>
  /** 发之前渲染海报并判定；不传就是「这次没有图可发」。 */
  prepare?: () => Promise<BriefingPublishPreparation>
}>): Readonly<{
  state: BriefingPushState
  push: () => void
  retry: () => void
  /** 只发文字：读者自己选的动作，不走海报那一路。 */
  sendTextOnly: () => void
  dismiss: () => void
}> {
  const [state, setState] = useState<BriefingPushState>({ kind: 'idle' })
  const sending = useRef(false)

  const resolved: BriefingPushState = input.blocked ? { kind: 'disabled', reason: input.blocked } : state

  const run = useCallback(async (options: Readonly<{ textOnly: boolean }>): Promise<void> => {
    // A click while a send is in flight is dropped here, not only disabled in the view: a slow network is
    // exactly when a reader taps twice, and the phone must not receive the same edition twice.
    if (sending.current || !input.edition || input.blocked) return
    sending.current = true
    setState({ kind: 'sending' })
    try {
      let poster: BriefingPosterBytes | undefined
      if (!options.textOnly && input.prepare !== undefined) {
        const prepared = await input.prepare()
        // 三种「整条不发」都发生在**第一个字节出站之前**：这里直接返回，一次 IPC 都不发。
        if (prepared.kind === 'caption-too-long') {
          setState({ kind: 'caption-too-long', chars: prepared.chars })
          return
        }
        if (prepared.kind === 'poster-render-failed') {
          setState({ kind: 'failed', reason: 'poster-render-failed' })
          return
        }
        if (prepared.kind === 'poster-too-large') {
          setState({ kind: 'poster-too-large', byteLength: prepared.byteLength })
          return
        }
        if (prepared.kind === 'ready-with-poster') poster = prepared.poster
      }
      const outcome = await (input.send ?? redeliverBriefingPush)(input.edition, poster)
      if (outcome.state === 'result') {
        setState({
          kind: 'result',
          delivery: outcome.delivery,
          // 没有字节就是只发了文字（读者选的，或这一版没有可渲染的纸）——结果句的形态前缀据此写。
          attempt: poster === undefined ? 'text' : 'poster',
          ...(outcome.deliveryReason === undefined ? {} : { deliveryReason: outcome.deliveryReason }),
          ...(outcome.channels === undefined ? {} : { channels: outcome.channels })
        })
        return
      }
      // A failure stays on screen with a reason and a retry.
      setState({ kind: 'failed', reason: outcome.reason })
    } finally {
      sending.current = false
    }
  }, [input])

  const push = useCallback(() => { void run({ textOnly: false }) }, [run])
  // 重试 = 再走一遍完整流程（重新渲染海报）：图渲不出来多半是一次性的。
  const retry = useCallback(() => { void run({ textOnly: false }) }, [run])
  const sendTextOnly = useCallback(() => { void run({ textOnly: true }) }, [run])
  const dismiss = useCallback(() => setState({ kind: 'idle' }), [])

  return { state: resolved, push, retry, sendTextOnly, dismiss }
}
