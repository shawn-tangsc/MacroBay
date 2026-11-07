import type { AgentChatContextReference } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { DailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { dailyBriefSessionCopy, dailyBriefSessionCopyText, dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'
import type { DailyBriefSessionState } from './dailyBriefSessionLinks'

/**
 * 一次回合为什么没写完——**三种**，不许合成一种（架构师 2026-11-07 退回项）。
 *
 * 运行时的终态是 `pending | success | paused | error`：
 * - `paused` 且**我们自己的中止信号**已触发 → `cancelled`：是这次运行的截止/取消，不是应用退出；
 * - `paused` 而我们的信号没触发 → `run-interrupted`：运行时被别人停的，应用正在关闭是最常见的那种；
 * - `error` → `failed`：模型/网关自己报的错，**必须保留它的真实失败码**，不许说成"应用被关闭了"。
 *
 * 为什么不能只留一个 `stopped: true`：那样 `error` 会被写成"应用在这之前被关闭了"，正是这条
 * 判据要消灭的那种冒充，只是方向反过来。
 */
export type DailyBriefTurnStop = 'cancelled' | 'run-interrupted' | 'failed'

export type DailyBriefTurnStopped = Readonly<{
  stopped?: boolean
  stoppedReason?: DailyBriefTurnStop
  /** 只在 `failed` 时有值：平台给出的 provider 失败码（映射成日报自己的失败码）。 */
  failureCode?: string
  /** 平台原始码，写进明细供排查；不给读者看。 */
  failureDetail?: string
}>

export type DailyBriefAgentRunner = Readonly<{
  /**
   * `onSession` reports the session as soon as it exists — before the first turn resolves — so a
   * generation that times out mid-turn still knows which runtime session to abandon.
   */
  start: (input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; prompt: string; topic?: string; context?: AgentChatContextReference; displayText?: string; allowedTools?: readonly string[]; signal?: AbortSignal; onSession?: (sessionId: string) => void }>) => Promise<{ sessionId: string; created: boolean; assistantText: string; toolInvocations: readonly AgentRuntimeToolInvocation[] } & DailyBriefTurnStopped>
  continue: (sessionId: string, text: string, displayText?: string, signal?: AbortSignal) => Promise<{ assistantText: string; toolInvocations: readonly AgentRuntimeToolInvocation[] } & DailyBriefTurnStopped>
  finish: (sessionId: string, state: DailyBriefSessionState) => Promise<void>
}>

export function createDailyBriefAgentRunner(deps: Readonly<{
  port: DailyBriefEditorSessionPort
  agentId: string
}>): DailyBriefAgentRunner {
  return Object.freeze({
    async start(input) {
      const title = dailyBriefSessionTitle({ date: input.date, locale: input.locale, ...(input.topic ? { topic: input.topic } : {}) })
      const session = await deps.port.ensure({ editionDate: input.date, periodId: input.periodId, locale: input.locale, title, agentId: deps.agentId, ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}) })
      input.onSession?.(session.sessionId)
      cancelOnAbort(deps.port, input.signal, session.sessionId)
      const result = await deps.port.send(session.sessionId, { agentId: deps.agentId, sessionId: session.sessionId, text: input.prompt, displayText: input.displayText ?? dailyBriefSessionCopyText(dailyBriefSessionCopy(input.locale).startTask, { date: input.date }) })
      return { ...session, assistantText: result.assistantMessage.searchableText, toolInvocations: result.toolInvocations ?? [], ...stoppedOf(result, input.signal) }
    },
    async continue(sessionId, text, displayText, signal) {
      cancelOnAbort(deps.port, signal, sessionId)
      const result = await deps.port.send(sessionId, { agentId: deps.agentId, sessionId, text, ...(displayText ? { displayText } : {}) })
      return { assistantText: result.assistantMessage.searchableText, toolInvocations: result.toolInvocations ?? [], ...stoppedOf(result, signal) }
    },
    finish: (sessionId, state) => deps.port.state(sessionId, state)
  })
}

/**
 * 终态三态分离。`signal` 是**这一次运行自己的**中止信号：它已触发说明是这次运行的截止/取消，
 * 不是应用退出。顺序不能反——先判 `error`（模型自己的错，带真实码），再判 paused 是谁停的。
 */
function stoppedOf(
  result: Readonly<{ assistantMessage: Readonly<{ status: string; data?: Readonly<{ parts?: readonly unknown[] }> }> }>,
  signal: AbortSignal | undefined
): DailyBriefTurnStopped {
  const status = result.assistantMessage.status
  if (status === 'success') return {}
  if (status === 'error') {
    const raw = runtimeFailureCodeOf(result.assistantMessage)
    return Object.freeze({
      stopped: true,
      stoppedReason: 'failed' as const,
      failureCode: briefFailureCodeOf(raw),
      ...(raw === undefined ? {} : { failureDetail: raw })
    })
  }
  // paused：我们自己的信号触发了是取消；没触发就是被运行时（应用退出）停的。
  return signal?.aborted === true
    ? Object.freeze({ stopped: true, stoppedReason: 'cancelled' as const })
    : Object.freeze({ stopped: true, stoppedReason: 'run-interrupted' as const })
}

/** 错误消息里带着平台写的那个 code（`agent.runtime.<code>`），逐字读出来，不从文案猜。 */
function runtimeFailureCodeOf(message: Readonly<{ data?: Readonly<{ parts?: readonly unknown[] }> }>): string | undefined {
  for (const part of message.data?.parts ?? []) {
    if (!part || typeof part !== 'object') continue
    const key = (part as { key?: unknown }).key
    if (typeof key !== 'string' || !key.startsWith('agent.runtime.')) continue
    const code = key.slice('agent.runtime.'.length).trim()
    if (code.length > 0) return code
  }
  return undefined
}

/**
 * 平台码 → 日报自己的失败码。**只做这几条确定的映射**，其余一律 `provider-error`：
 * 宁可说"供应商返回错误"，也不替它断言"缺 Key"或"模型下线"。
 */
function briefFailureCodeOf(raw: string | undefined): string {
  if (raw === 'provider-model-retired' || raw === 'provider-model-not-activated' || raw === 'provider-model-not-found') return 'model-unavailable'
  return 'provider-error'
}

/**
 * 一次被停下的回合该写成什么：失败码、明细、会话终态。**三处调用点（写作轮、重写轮、回合收尾）
 * 读同一份映射**，谁也别自己写一遍——一处写成"应用被关闭了"，另一处写成失败码，就成了两种说法。
 */
export type DailyBriefTurnOutcome = Readonly<{
  failureCode: string
  failureDetail: string
  finish: DailyBriefSessionState
}>

export function stoppedOutcome(stopped: DailyBriefTurnStopped): DailyBriefTurnOutcome {
  if (stopped.stoppedReason === 'failed') {
    // 模型/网关自己报错：保留它的真实码，明细带平台原始码，不写"没写完"。
    const code = stopped.failureCode ?? 'provider-error'
    return Object.freeze({ failureCode: code, failureDetail: stopped.failureDetail ?? code, finish: 'failed' as const })
  }
  if (stopped.stoppedReason === 'cancelled') {
    return Object.freeze({ failureCode: 'cancelled', failureDetail: 'aborted', finish: 'abandoned' as const })
  }
  return Object.freeze({ failureCode: 'run-interrupted', failureDetail: 'runtime stopped mid-turn', finish: 'abandoned' as const })
}

/**
 * Stops this session once the generation's deadline aborts. The runtime already turns that into a
 * `paused` turn result, so the caller still receives an answer instead of an error; the turn loop
 * is what refuses to open the next round.
 */
function cancelOnAbort(port: DailyBriefEditorSessionPort, signal: AbortSignal | undefined, sessionId: string): void {
  if (!signal) return
  // A runtime that already stopped answers this with an error or a false result; that is not a
  // generation failure, and the voided promise must not become an unhandled rejection.
  const cancel = () => { void port.cancel(sessionId).catch(() => undefined) }
  if (signal.aborted) { cancel(); return }
  signal.addEventListener('abort', cancel, { once: true })
}
