import type { StructuredModelInvocationErrorCode } from '@platform/ai/invocation/structuredModelInvocationTypes'

/**
 * 翻译批次失败的**闭集**（情报需求 §十五）：读者看到的每一类，**下一步动作都不一样**。
 *
 * 为什么是这五类，而不是「内容为空 / 语言不支持」：平台上模型调用的错误码本身就是闭集
 * （`structuredModelInvocationTypes.ts`），里面**没有**那两种码——照文档实现就是两个永远
 * 触发不了的分支。**没有触发条件的类别不许进表**，否则它只会让人觉得「这两类已经处理了」。
 *
 * 映射只在这一处做：解析人、日志行、页面显示都读同一个分类结果，不各写一张表。
 */
export const BATCH_FAILURE_REASONS = Object.freeze([
  /** 模型超时：等一会儿再试。 */
  'timeout',
  /** 被限流：等一会儿再试；持续出现就查额度或换 key。 */
  'rate-limited',
  /** 没配好模型（缺 key / 供应商停用 / 模型未就绪）：去设置里配。 */
  'model-unavailable',
  /** 模型输出不合法（不是 JSON / 不合 schema）：稍后重试；持续出现换模型。 */
  'model-output-invalid',
  /** 其余（供应商报错、调用被取消）：看诊断。 */
  'other'
] as const)

export type BatchFailureReason = (typeof BATCH_FAILURE_REASONS)[number]

export type BatchFailureTally = Readonly<Partial<Record<BatchFailureReason, number>>>

/**
 * 一处映射：平台错误码 → 读者能据以行动的那一类。
 *
 * `cancelled` 归「其它」而不是「超时」：模型根本没拿到预算（窗口关了、任务被取消），
 * 说成「太慢」会把读者引到错的处置上去。
 */
export function translationFailureKindOf(code: string | undefined): BatchFailureReason {
  switch (code satisfies StructuredModelInvocationErrorCode | string | undefined) {
    case 'timeout':
      return 'timeout'
    case 'rate-limited':
      return 'rate-limited'
    case 'missing-api-key':
    case 'provider-disabled':
    case 'model-not-ready':
      return 'model-unavailable'
    case 'invalid-json':
    case 'schema-validation-failed':
      return 'model-output-invalid'
    default:
      return 'other'
  }
}

/** 记一次失败；同一类只加次数，不按条刷屏。 */
export function countTranslationFailure(
  tally: Record<BatchFailureReason, number>,
  code: string | undefined
): void {
  tally[translationFailureKindOf(code)] += 1
}

/** 只留下真的发生过的那几类：批次摘要里不写一堆 0。 */
export function settledTranslationFailures(
  tally: Readonly<Record<BatchFailureReason, number>>
): BatchFailureTally {
  const settled: Partial<Record<BatchFailureReason, number>> = {}
  for (const kind of BATCH_FAILURE_REASONS) {
    const count = tally[kind]
    if (count > 0) settled[kind] = count
  }
  return Object.freeze(settled)
}

/**
 * 运行记录里的原因码：点分小写，一个码一句话（六句人话由文案表映射）。
 *
 * 为什么不直接把 `BatchFailureReason` 写进记录：那个词是产品内部的分类词，运行记录是
 * 读者与统计都要读的地方，码的形状必须是稳定枚举（`assertJobRunOutcome` 只收点分小写）。
 * 映射只在这里做，别处不许再拼一个。
 */
const RUN_REASON_CODES: Readonly<Record<BatchFailureReason, string>> = Object.freeze({
  'timeout': 'model.timeout',
  'rate-limited': 'model.rate-limited',
  'model-unavailable': 'model.not-configured',
  'model-output-invalid': 'model.output-invalid',
  'other': 'translation.undetermined'
})

/** 自动翻译没开时那一批：不是失败，是「跳过」，所以有自己的码。 */
export const TRANSLATION_AUTO_OFF_REASON_CODE = 'translation.auto-off'

export function translationRunReasonCode(kind: BatchFailureReason): string {
  return RUN_REASON_CODES[kind]
}

/**
 * 失败**按原因拆开**的条数：`{ 'model.timeout': 1, 'model.rate-limited': 1 }`。
 *
 * 一个主因码说不出「超时 1、限流 1」，所以分布单独给；加起来必须等于失败总数（平台写入时校验），
 * 没有失败时整张表不出现——全零表会被读成「测过了，确实没有原因」。
 */
export function translationReasonDistribution(
  tally: Readonly<Record<BatchFailureReason, number>>
): Readonly<Record<string, number>> | undefined {
  const distribution: Record<string, number> = {}
  for (const kind of BATCH_FAILURE_REASONS) {
    const count = tally[kind]
    if (count > 0) distribution[translationRunReasonCode(kind)] = count
  }
  return Object.keys(distribution).length > 0 ? Object.freeze(distribution) : undefined
}

/**
 * 一批里失败原因可能不止一种，记录只能写一个码：取发生次数最多的那一类。
 * 只在真的有失败时调用——没有失败就不该有原因码。
 */
export function dominantTranslationFailure(
  tally: Readonly<Record<BatchFailureReason, number>>
): BatchFailureReason | undefined {
  let dominant: BatchFailureReason | undefined
  for (const kind of BATCH_FAILURE_REASONS) {
    const count = tally[kind]
    if (count <= 0) continue
    if (!dominant || count > tally[dominant]) dominant = kind
  }
  return dominant
}
