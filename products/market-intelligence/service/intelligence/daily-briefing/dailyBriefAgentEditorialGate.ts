import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import type { DailyBriefTurnStage, DailyBriefTurnStageEvent } from './dailyBriefAgentTurn'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { DailyBriefingEditorialOutput, DailyBriefingValidation } from './dailyBriefingValidation'
import { describeFailures } from './dailyBriefingValidationFailures'

/**
 * 写完之后那一步：校验、必要时重写，直到通过或轮数用完。
 *
 * 抽出来的理由不是行数：这一段有自己的三条纪律，混在回合主流程里每次都被写错——
 * ① **被停下的回合不是坏答案**：运行时中途停（应用退出、会话被停）时回一句「已停止。」；
 *    拿去解析只会得到 invalid-json，再去重写只会撞上已经释放的运行时；
 * ② **重写失败不许冒充超时**：拿不到运行时是 cancelled，其余情况保留这一轮真正的失败码
 *    （例如 invalid-json），把错误接在明细后面；
 * ③ **解析不出来要留证据**：留前 160 字、换行压平，否则下一次只能猜是提示词还是解析器。
 */
export type EditorialGateOutcome =
  | Readonly<{ state: 'accepted'; document: DailyBriefingDocument; toolInvocations: readonly AgentRuntimeToolInvocation[] }>
  | Readonly<{ state: 'failed'; failureCode: string; failureDetail?: string; toolInvocations: readonly AgentRuntimeToolInvocation[] }>
  | Readonly<{ state: 'cancelled'; failureDetail: string; toolInvocations: readonly AgentRuntimeToolInvocation[] }>

const stoppedDetail = 'runtime stopped mid-turn'

/** 只有真被停/被释放才算取消；其余错误一律照实传。 */
export function isCancellation(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message : String(error)
  return /abort|disposed|cancelled|canceled|stopped/i.test(message)
}

/** 解析不出来时留的那一小段：压平空白、截断，整份响应不进日志。 */
export function unparsableDetail(response: string): string {
  const excerpt = response.trim().replace(/\s+/g, ' ').slice(0, 160)
  return excerpt.length > 0 ? `unparsable: ${excerpt}` : 'unparsable: empty response'
}

export async function runEditorialGate(input: Readonly<{
  runner: DailyBriefAgentRunner
  sessionId: string
  written: string
  maximumRounds: number
  signal?: AbortSignal
  /** 选择与写作两轮已经发生的工具调用；重写轮会把新的续在后面。 */
  toolInvocations: readonly AgentRuntimeToolInvocation[]
  stage: (event: DailyBriefTurnStageEvent) => void
  repairPrompt: (code: string, detail: string | undefined, failures: readonly Readonly<{ code: string; detail?: string }>[] | undefined) => string
  validate: (parsed: unknown) => DailyBriefingValidation
  apply: (value: DailyBriefingEditorialOutput) => DailyBriefingDocument
}>): Promise<EditorialGateOutcome> {
  const stage = input.stage
  const tools = [...input.toolInvocations]
  let response = input.written
  let failureCode = 'invalid-json'
  let failureDetail: string | undefined
  let lastFailures: readonly Readonly<{ code: string; detail?: string }>[] | undefined
  for (let attempt = 0; attempt <= input.maximumRounds; attempt++) {
    // Each check times itself. A check that fails closes before the repair it triggers, so the repair
    // row owns the seconds it spends and the validation row does not silently include them.
    stage({ stage: 'validation', state: 'begin' })
    let parsed: unknown
    try { parsed = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) } catch { parsed = undefined }
    if (!parsed) failureDetail = unparsableDetail(response)
    if (parsed) {
      const validation = input.validate(parsed)
      if (validation.ok) {
        stage({ stage: 'validation', state: 'success' })
        return { state: 'accepted', document: input.apply(validation.value), toolInvocations: Object.freeze(tools) }
      }
      failureCode = validation.failureCode
      failureDetail = validation.detail
      lastFailures = validation.failures
    }
    // Every defect, not just the first: the code names the kind of problem, the detail names the fields,
    // and a reader who only ever sees the kind cannot act on it.
    const described = lastFailures ? describeFailures(lastFailures) : undefined
    stage({ stage: 'validation', state: 'failed', failureCode, ...(described ? { failureDetail: described } : failureDetail ? { failureDetail } : {}) })
    if (attempt >= input.maximumRounds) break
    if (input.signal?.aborted) return { state: 'cancelled', failureDetail: 'aborted', toolInvocations: Object.freeze(tools) }
    const repairStage = `repair-${attempt + 1}` as DailyBriefTurnStage
    stage({ stage: repairStage, state: 'begin' })
    try {
      const repair = await input.runner.continue(input.sessionId, input.repairPrompt(failureCode, failureDetail, lastFailures), undefined, input.signal)
      if (repair.stopped) {
        stage({ stage: repairStage, state: 'failed', failureCode: 'cancelled', failureDetail: stoppedDetail })
        return { state: 'cancelled', failureDetail: stoppedDetail, toolInvocations: Object.freeze(tools) }
      }
      response = repair.assistantText
      tools.push(...repair.toolInvocations)
      stage({ stage: repairStage, state: 'success' })
    } catch (error) {
      const cancelled = isCancellation(error)
      const code = cancelled ? 'cancelled' : failureCode
      const detail = error instanceof Error && error.message ? error.message : 'repair-failed'
      stage({ stage: repairStage, state: 'failed', failureCode: code, failureDetail: detail })
      // 取消就报取消；否则保留这一轮真正的失败码，把重写的错误接在明细后面（不许盖成超时）。
      return cancelled
        ? { state: 'cancelled', failureDetail: detail, toolInvocations: Object.freeze(tools) }
        : { state: 'failed', failureCode: code, failureDetail: [failureDetail, `repair: ${detail}`].filter(Boolean).join(' · '), toolInvocations: Object.freeze(tools) }
    }
  }
  const finalDetail = lastFailures ? describeFailures(lastFailures) ?? failureDetail : failureDetail
  stage({ stage: 'validation', state: 'failed', failureCode, ...(finalDetail ? { failureDetail: finalDetail } : {}) })
  return { state: 'failed', failureCode, ...(finalDetail ? { failureDetail: finalDetail } : {}), toolInvocations: Object.freeze(tools) }
}
