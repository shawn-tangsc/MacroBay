import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { stoppedOutcome } from './dailyBriefAgentRunner'
import type { DailyBriefTurnStage, DailyBriefTurnStageEvent } from './dailyBriefAgentTurn'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { DailyBriefingEditorialOutput, DailyBriefingValidation } from './dailyBriefingValidation'
import { describeFailures } from './dailyBriefingValidationFailures'
import { turnFailureCode } from './dailyBriefingGenerationGuards'

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
  | Readonly<{ state: 'interrupted'; failureDetail: string; toolInvocations: readonly AgentRuntimeToolInvocation[] }>

const stoppedDetail = 'runtime stopped mid-turn'

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 只有 `AbortError` 才算取消；其余抛出来的错误按类型化名字归类（见 `turnFailureCode`）。 */
export function isCancellation(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message : String(error)
  return /\babort(ed)?\b|cancelled|canceled/i.test(message)
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
  /**
   * 按**渲染结果**扫语言（`04` §3.4.2）：拿到已经构建出来的文档，返回命中的叶子（路径点名）。
   *
   * 命中不丢段、不翻译：按一次修复重写处理；重写仍命中，这一版以 `invalid-output-language`
   * 失败——读者看到失败行与原因，可以重试。
   */
  checkLanguage?: (document: DailyBriefingDocument) => readonly Readonly<{ path: string }>[]
}>): Promise<EditorialGateOutcome> {
  const stage = input.stage
  const tools = [...input.toolInvocations]
  let response = input.written
  let failureCode = 'invalid-json'
  let failureDetail: string | undefined
  let lastFailures: readonly Readonly<{ code: string; detail?: string }>[] | undefined
  /**
   * 语言只给一次重写机会（B6）：别的失败可以按 `maximumRounds` 多轮打磨，语言不行——重写后
   * 还是那种语言，说明这一版就是不该发出去，再赌两轮只是让读者多等两次同样的失败。
   */
  let languageRepairUsed = false
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
        const document = input.apply(validation.value)
        // 语言只在**构建出来的文档**上判（读者看的是这一份，不是模型那份 JSON）：字段清单式校验
        // 会随字段增加而漏，按渲染结果扫就不会。
        const breaches = input.checkLanguage?.(document) ?? []
        if (breaches.length === 0) {
          stage({ stage: 'validation', state: 'success' })
          return { state: 'accepted', document, toolInvocations: Object.freeze(tools) }
        }
        failureCode = 'invalid-output-language'
        failureDetail = breaches[0]!.path
        lastFailures = undefined
      } else {
        failureCode = validation.failureCode
        failureDetail = validation.detail
        lastFailures = validation.failures
      }
    }
    // Every defect, not just the first: the code names the kind of problem, the detail names the fields,
    // and a reader who only ever sees the kind cannot act on it.
    const described = lastFailures ? describeFailures(lastFailures) : undefined
    stage({ stage: 'validation', state: 'failed', failureCode, ...(described ? { failureDetail: described } : failureDetail ? { failureDetail } : {}) })
    // 已经为语言重写过一次：这次仍命中就整版拒发，不再调用模型。
    if (failureCode === 'invalid-output-language' && languageRepairUsed) break
    if (attempt >= input.maximumRounds) break
    if (input.signal?.aborted) return { state: 'cancelled', failureDetail: 'aborted', toolInvocations: Object.freeze(tools) }
    if (failureCode === 'invalid-output-language') languageRepairUsed = true
    const repairStage = `repair-${attempt + 1}` as DailyBriefTurnStage
    stage({ stage: repairStage, state: 'begin' })
    try {
      const repair = await input.runner.continue(input.sessionId, input.repairPrompt(failureCode, failureDetail, lastFailures), undefined, input.signal)
      if (repair.stopped) {
        // 重写轮被停：三种分开，映射只有一处（`stoppedOutcome`）。只有"运行时被停"才算中断；
        // 我们自己的信号是取消；模型/网关自己报错就保留它的真实码——不许写成"应用被关闭了"。
        const stop = stoppedOutcome(repair)
        stage({ stage: repairStage, state: 'failed', failureCode: stop.failureCode, failureDetail: stop.failureDetail })
        if (stop.finish === 'failed') return { state: 'failed', failureCode: stop.failureCode, failureDetail: stop.failureDetail, toolInvocations: Object.freeze(tools) }
        return stop.failureCode === 'cancelled'
          ? { state: 'cancelled', failureDetail: stop.failureDetail, toolInvocations: Object.freeze(tools) }
          : { state: 'interrupted', failureDetail: stop.failureDetail, toolInvocations: Object.freeze(tools) }
      }
      response = repair.assistantText
      tools.push(...repair.toolInvocations)
      stage({ stage: repairStage, state: 'success' })
    } catch (error) {
      // 抛出来的错误只按**类型化名字**归类：取消 → cancelled；超时 → 超时码；其余 → provider-error。
      // 不在报文里找"disposed/stopped"这类词（架构师保留项，2026-11-07）：那是把提示语当协议。
      const code = turnFailureCode(error)
      const detail = error instanceof Error && error.message ? error.message : 'repair-failed'
      // 取消报取消，超时报超时；**其余保留这一轮真正的失败码**（例如 `invalid-json`）——重写之所以
      // 没成，不能把"这次输出不合法"这条更可行动的事实盖掉，错误原文接在明细后面。
      const reported = code === 'cancelled' || code === 'editorial-timeout' ? code : failureCode
      stage({ stage: repairStage, state: 'failed', failureCode: reported, failureDetail: detail })
      return code === 'cancelled'
        ? { state: 'cancelled', failureDetail: detail, toolInvocations: Object.freeze(tools) }
        : { state: 'failed', failureCode: reported, failureDetail: [failureDetail, `repair: ${detail}`].filter(Boolean).join(' · '), toolInvocations: Object.freeze(tools) }
    }
  }
  const finalDetail = lastFailures ? describeFailures(lastFailures) ?? failureDetail : failureDetail
  stage({ stage: 'validation', state: 'failed', failureCode, ...(finalDetail ? { failureDetail: finalDetail } : {}) })
  return { state: 'failed', failureCode, ...(finalDetail ? { failureDetail: finalDetail } : {}), toolInvocations: Object.freeze(tools) }
}
