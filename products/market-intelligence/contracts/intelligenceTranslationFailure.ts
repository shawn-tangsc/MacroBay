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
