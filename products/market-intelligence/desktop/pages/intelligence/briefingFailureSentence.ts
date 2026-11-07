import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 失败原因的那句话：**由表里的三段拼出来**，不在这里造句，也不把码换个说法。
 *
 * 用户 2026-11-06：点开失败行只写「AI 编辑超时」，读者看不出是"写稿那一步卡了两分钟"。
 * `02` v2.143 把结构定死：
 *
 * - trace 里有卡住的那一步：`{步骤}没跑完：{what}（用了 {时长}）`
 * - 没有卡住的那一步（比如模型没配好，一步都没进）：`这次在{step}就停下了：{what}`
 * - 时长算不出来：用不带时长的那一句，**不留空括号**
 *
 * 三段（哪一步 / 发生了什么 / 接下来怎么办）逐码写在 `text.failureSentences` 里，是文案的事；
 * 这里只按句式拼。表里没有这个码就走 `fallback` 那一句——**绝不把码印给读者**，也绝不半句。
 */
export type BriefingFailureSentenceEntry = Readonly<{ step: string; what: string; next: string }>

export type BriefingFailureSentences = Readonly<Record<string, BriefingFailureSentenceEntry>>

export type BriefingFailureSentenceInput = Readonly<{
  code: string | undefined
  /** trace 里卡住那一步的名字；没有就用表里的 `step` 兜底。 */
  failedStage?: string
  /**
   * 保留但**不再使用**（`02` v2.169）：失败句不带时长——读者只问"为什么没出来""我还能做什么"，
   * 一个秒数只会引出"为什么这么慢"这个我们答不了的问题。时长只在步骤明细里。
   */
  durationMs?: number
  sentences: BriefingFailureSentences
  /** 表外码的唯一出口：走这一句，绝不印出码本身（`02` v2.145）。 */
  fallback: BriefingFailureSentenceEntry
  templates: DailyBriefingText['failureSentenceTemplates']
}>

export function briefingFailureSentence(
  input: BriefingFailureSentenceInput
): Readonly<{ reason: string; next: string }> {
  // 码没登记、或者根本没有码：走兜底句。读者不会在这里看到内部代号。
  const entry = (input.code === undefined ? undefined : input.sentences[input.code]) ?? input.fallback
  const reason = input.failedStage === undefined
    ? input.templates.stoppedAt.replace('{step}', entry.step).replace('{what}', entry.what)
    : input.templates.unfinishedNoDuration.replace('{stage}', input.failedStage).replace('{what}', entry.what)
  return Object.freeze({ reason, next: input.templates.next.replace('{next}', entry.next) })
}
