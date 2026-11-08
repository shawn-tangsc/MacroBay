import { useRef, useState } from 'react'

import { sendAnalysisConclusion as defaultSend, type AnalysisConclusionSendReceipt } from '../../shared/ipc/analysisConclusionSendClient'
import { describeSendStatus, type ChannelAvailability, type SendStatusCopy } from './analysisConclusionSendCopy'
import { classifySendReceipt } from './analysisConclusionSendState'
import type { AnalysisConclusionSendText } from './analysisConclusionSendText'

/**
 * 抽屉里那枚「发送到频道」的状态机。
 *
 * 三条写死：
 * 1. **发送中不可再发**：状态在 `sending` 时直接返回，按钮再 `disabled`，两层都挡（连点会是两条记录）；
 * 2. **失败也不静默**：IPC 抛错、回执认不出，都收敛成一句话 + 折叠原因码，不假装发出去了；
 * 3. **不碰任何本地状态**：不发已读、不改时间轴顺序、不改记录——它只是一次提交。
 */
export type SendPhase =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'sending' }>
  | Readonly<{ kind: 'result'; status: SendStatusCopy }>

export function useAnalysisConclusionSend(input: Readonly<{
  text: AnalysisConclusionSendText
  /** 这一条分析运行的 id；没有它就没有可发的东西（按钮应当已按此禁用）。 */
  analysisRunId?: string | undefined
  /** 这次会发给哪条通道（`resolvePushChannel` 的派生）；读不到就省略。 */
  channel?: ChannelAvailability | undefined
  /** 台面注入：默认走产品 IPC，用例里换成桩。 */
  send?: ((analysisRunId: string) => Promise<AnalysisConclusionSendReceipt>) | undefined
  /** 结果行里的时刻（读者时区，已格式化）。 */
  formatNow?: (() => string) | undefined
}>): Readonly<{ phase: SendPhase; send: () => Promise<void> }> {
  const [phase, setPhase] = useState<SendPhase>({ kind: 'idle' })
  // 真发的时候先落一个同步闸：同一帧里连点两次时，state 还停在 `idle`，光看 `phase` 挡不住。
  const inFlight = useRef(false)
  const send = input.send ?? defaultSend
  const formatNow = input.formatNow ?? (() => new Date().toTimeString().slice(0, 5))
  async function run(): Promise<void> {
    if (inFlight.current || input.analysisRunId === undefined) return
    inFlight.current = true
    setPhase({ kind: 'sending' })
    let status: SendStatusCopy
    try {
      const receipt = await send(input.analysisRunId)
      status = describeSendStatus({
        state: classifySendReceipt(receipt),
        text: input.text,
        // 通道名跟着这次提交的结果走；点击前的那份派生只判「有没有可用通道」。
        ...(receipt.kind === 'accepted' && receipt.delivery?.push?.channelName !== undefined
          ? { receiptChannelName: receipt.delivery.push.channelName }
          : {}),
        channel: input.channel,
        time: formatNow()
      })
    } catch (error) {
      // 请求根本没到：给「没发出去」+ 原因码，不编一个平台没说过的话。
      status = describeSendStatus({
        state: { state: 'failed', reason: error instanceof Error && error.message.length > 0 ? error.message : 'invoke-failed' },
        text: input.text,
        channel: input.channel,
        time: formatNow()
      })
    }
    inFlight.current = false
    setPhase({ kind: 'result', status })
  }
  return { phase, send: run }
}
