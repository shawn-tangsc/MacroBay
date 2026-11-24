import type { DatabaseSync } from 'node:sqlite'

import type { StructuredModelTaskResult } from '@platform/ai/invocation/structuredModelInvocationTypes'

import {
  calendarInterpretationDataKey, calendarInterpretationFailureCodes, calendarInterpretationTier,
  interpretationCitesOnlyEnvelopeNumbers, interpretationTextFits,
  type CalendarInterpretationFailureCode, type CalendarInterpretationValues
} from './calendarEventInterpretationPolicy'
import {
  calendarInterpretationMessages, type CalendarInterpretationEnvelope, type CalendarInterpretationLocale
} from './calendarEventInterpretationEnvelope'
import { readCalendarInterpretation, writeCalendarInterpretation } from './calendarEventInterpretationStore'

/**
 * 生成一次解读（R36 技术方案 §4）。
 *
 * 顺序有意：**先判档，再看有没有现成的，最后才花模型调用**。
 * - 低档与未分级：直接 `not-applicable`，连信封都不建；
 * - 同一份数据已有 `ready`：直接返回它（读者点开第二次不重新调模型）；
 * - 失败行：**只有读者要求重试时才再试**（`trigger: 'request'`），自动路径碰上失败就停——
 *   否则一条每次都失败的模型调用会在每个采集周期重烧一遍。
 *
 * 校验只有两类：形状/长度（太短、太长、非法 JSON）与事实（引用了信封里没有的数字）。
 * 不查句式、不查词表：那种规则会随模型换说法而误判。
 */

export type CalendarInterpretationGeneratorDeps = Readonly<{
  database: DatabaseSync
  invoke: (request: Parameters<CalendarInterpretationInvoke>[0]) => ReturnType<CalendarInterpretationInvoke>
  now: () => string
  /**
   * 用量计数（产品 2026-11-25）：**按族 + 档**报一次，进了用量报告才好回答「高档是不是约 20 次/月」。
   * 计数不是节流：它只记，不拦。
   */
  count?: (line: Readonly<{ eventKey: string; family: string; importance: string; state: CalendarInterpretationGenerationResult['state'] | 'skipped' }>) => void
}>

type CalendarInterpretationInvoke = (
  request: Readonly<{
    taskId: string
    messages: { role: 'system' | 'user'; content: string }[]
    parse: (value: unknown) => { text: string }
  }>
) => Promise<StructuredModelTaskResult<{ text: string }>>

export type CalendarInterpretationGeneration = Readonly<{
  eventKey: string
  importance: 'high' | 'medium' | 'low' | undefined
  locale: CalendarInterpretationLocale
  values: CalendarInterpretationValues
  /** 族（指标码第二段 / 官方标题键族名）：只用于用量计数，不参与判据。 */
  family: string
  /** 冻结信封：调用方按事件身份组好（往期、来源名都在里面），这里不读库拼它。 */
  buildEnvelope: () => Readonly<{ envelope: CalendarInterpretationEnvelope; snapshotHash: string; evidenceScope: readonly string[] }>
  /** `request`：读者点开或点重试；`auto`：高档的后台补生成，失败不重试。 */
  trigger: 'auto' | 'request'
}>

export type CalendarInterpretationGenerationResult =
  | Readonly<{ state: 'ready'; text: string; generatedAt: string; snapshotHash: string; evidenceScope: readonly string[]; cached: boolean }>
  /** 这一档不生成：低档与未分级。**不是失败**，不落失败标记。 */
  | Readonly<{ state: 'not-applicable' }>
  | Readonly<{ state: 'failed'; failureCode: CalendarInterpretationFailureCode }>

export function createCalendarInterpretationGenerator(deps: CalendarInterpretationGeneratorDeps) {
  /**
   * **同一事件单飞**（产品 2026-11-25 成本护栏）：连点、双击、快速重开不产生第二次模型调用。
   * 键含 `data_key` 与 `locale`：同一事件的数据变了、或读者换了语言，本来就该是另一次生成。
   * 存在闭包里而不是模块级：两份服务实例（测试、演示装配）不共享在飞队列。
   */
  const inFlight = new Map<string, Promise<CalendarInterpretationGenerationResult>>()

  function generate(input: CalendarInterpretationGeneration): Promise<CalendarInterpretationGenerationResult> {
    const flightKey = `${input.eventKey}|${calendarInterpretationDataKey(input.values)}|${input.locale}`
    const pending = inFlight.get(flightKey)
    if (pending !== undefined) return pending
    const started = run(input)
      .then((result) => {
        deps.count?.({ eventKey: input.eventKey, family: input.family, importance: input.importance ?? 'ungraded', state: result.state })
        return result
      })
      .finally(() => { inFlight.delete(flightKey) })
    inFlight.set(flightKey, started)
    return started
  }

  async function run(input: CalendarInterpretationGeneration): Promise<CalendarInterpretationGenerationResult> {
    if (calendarInterpretationTier(input.importance) === 'never') return { state: 'not-applicable' }
    const dataKey = calendarInterpretationDataKey(input.values)
    const key = { eventKey: input.eventKey, dataKey, locale: input.locale }
    const existing = readCalendarInterpretation(deps.database, key)
    if (existing?.state === 'ready' && existing.text !== undefined) {
      return { state: 'ready', text: existing.text, generatedAt: existing.generatedAt, snapshotHash: existing.snapshotHash, evidenceScope: existing.evidenceScope, cached: true }
    }
    // 自动路径不重试失败：重试属于读者的动作（或下一次数据变化）。
    if (existing?.state === 'failed' && existing.failureCode !== undefined && input.trigger === 'auto') {
      return { state: 'failed', failureCode: existing.failureCode }
    }
    const frozen = input.buildEnvelope()
    const result = await deps.invoke({
      taskId: `market-intelligence.calendar-interpretation:${input.eventKey}:${dataKey.slice(0, 12)}` as string,
      messages: [...calendarInterpretationMessages(frozen.envelope, input.locale)].map((message) => ({ ...message })),
      parse: (value: unknown) => ({ text: typeof (value as Record<string, unknown> | null)?.text === 'string' ? String((value as Record<string, unknown>).text).trim() : '' })
    })
    if (!result.ok) {
      const failureCode = mapFailure(result.errorCode)
      // **模型未就绪不落标记**：那是配置状态，不是这一次生成的结果。落成失败后，
      // 自动路径按「失败不重试」就再也不试了——配好模型的高档事件会永远没有解读。
      if (failureCode === 'model-unavailable') return { state: 'failed', failureCode }
      return fail(deps, key, frozen, failureCode)
    }
    const text = result.output.text
    if (!interpretationTextFits(text)) return fail(deps, key, frozen, 'invalid-output')
    if (!interpretationCitesOnlyEnvelopeNumbers(text, frozen.envelope)) return fail(deps, key, frozen, 'fact-mismatch')
    const generatedAt = deps.now()
    writeCalendarInterpretation(deps.database, {
      ...key, state: 'ready', text, modelRef: `${result.providerId}/${result.modelId}`,
      generatedAt, snapshotHash: frozen.snapshotHash, evidenceScope: frozen.evidenceScope
    })
    return { state: 'ready', text, generatedAt, snapshotHash: frozen.snapshotHash, evidenceScope: frozen.evidenceScope, cached: false }
  }

  function fail(
    _deps: CalendarInterpretationGeneratorDeps,
    key: Readonly<{ eventKey: string; dataKey: string; locale: CalendarInterpretationLocale }>,
    frozen: Readonly<{ snapshotHash: string; evidenceScope: readonly string[] }>,
    failureCode: CalendarInterpretationFailureCode
  ): CalendarInterpretationGenerationResult {
    writeCalendarInterpretation(deps.database, {
      ...key, state: 'failed', failureCode, generatedAt: deps.now(),
      snapshotHash: frozen.snapshotHash, evidenceScope: frozen.evidenceScope
    })
    return { state: 'failed', failureCode }
  }

  return { generate }
}

/** 平台错误码 → 我们对读者说的三类失败。闭集映射，表外一律 `provider-error`。 */
function mapFailure(code: string): CalendarInterpretationFailureCode {
  if (code === 'model-not-ready' || code === 'provider-disabled' || code === 'missing-api-key') return 'model-unavailable'
  if (code === 'timeout') return 'timeout'
  if (code === 'invalid-json' || code === 'schema-validation-failed') return 'invalid-output'
  return calendarInterpretationFailureCodes.includes(code as CalendarInterpretationFailureCode)
    ? code as CalendarInterpretationFailureCode
    : 'provider-error'
}