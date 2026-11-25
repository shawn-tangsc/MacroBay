import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import type { StructuredModelMessage } from '@platform/ai/invocation/structuredModelInvocationTypes'

/**
 * 一次拒绝之后怎么再问一遍：哪些拒绝值得重采样、每类缺陷给一句具体指令、被拒的回答截断后带回。
 *
 * 从 `analysisOrchestrator` 抽出来（那个文件越过 500 行软上限）：这里没有一次模型调用、没有
 * 运行状态机，只有「拒绝 → 修复消息」的纯映射，可以单独读、单独改文案。
 */

/**
 * The rejections worth another sample.
 *
 * Not retried: unsafe output (a policy problem, not a formatting one), timeouts, provider errors,
 * and cancellation — each already says something the reader can act on, and another call would
 * only spend the same budget twice.
 */
export const repairableRejection: ReadonlySet<string> = new Set([
  MARKET_ANALYSIS_ERROR_CODES.invalidJson,
  MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema,
  MARKET_ANALYSIS_ERROR_CODES.missingEvidence
])

/**
 * One concrete instruction per defect.
 *
 * The error code alone is too coarse to repair: `missing evidence` covers a missing
 * `directions` horizon, an ineligible reaction fact and three different reference mistakes, and
 * telling all of them "you cited an unknown reference" sends the model to rewrite citations that
 * were never the problem. Shape rejections name the section or the missing top-level key; the
 * matching sentence says what that section must contain.
 *
 * Deliberately short: the system prompt already carries the full schema, so this only points at
 * the one thing the first attempt could not see.
 */
const repairInstructions: Readonly<Record<string, string>> = Object.freeze({
  'invalid-json': '上一次回复不是合法 JSON（可能被截断）。请重新输出完整、闭合的 JSON；必要时压缩各数组的条数。',
  'shape:top-level': '上一次输出的顶层字段与契约不一致：顶层必须恰好是 conclusion、knownFacts、transmissionHypotheses、marketReaction、supportingEvidence、counterEvidence、scenarios、directions、nextCatalysts、dataCaveats、evidenceRefs，加上**可选**的 divergences；其余不增不减。',
  'shape:conclusion': 'conclusion 必须恰好包含 direction、summary、change、causalChain、conditions、macro、evidenceStrength、dataGaps；direction 只能取五个 key，macro 与 evidenceStrength 没有内容时写 null。',
  'shape:directions': 'directions 必须恰好 short、medium、long 各一条；每条含 horizon、direction、rationale、confidence、evidenceRefIds，confidence 只能是 low、medium 或 high。',
  'shape:scenarios': '每个 scenario 必须恰好包含 asset、horizon、baseCase、conditions、invalidation、status；asset 只能是 BTC 或 ETH，status 只能是 pending。',
  'shape:knownFacts': '每条 knownFacts 必须恰好包含 factId、statement、evidenceRefIds，其中 evidenceRefIds 恰好是该事实自己的那一个 evidenceRef。',
  'shape:transmissionHypotheses': '每条 transmissionHypotheses 必须恰好包含 statement 与 evidenceRefIds（非空）。',
  'shape:marketReaction': '每条 marketReaction 必须包含 statement、factIds、evidenceRefIds；没有可比行情时写 []。',
  'shape:supportingEvidence': '每条 supportingEvidence 必须恰好包含 statement 与 evidenceRefId。',
  'shape:counterEvidence': '每条 counterEvidence 必须恰好包含 statement 与 evidenceRefId。',
  'shape:nextCatalysts': '每条 nextCatalysts 必须包含 statement 与 evidenceRefIds（非空）；可选的 calendarEventKey 要么不写，要么是一个非空字符串。',
  'shape:dataCaveats': 'dataCaveats 必须是字符串数组；没有内容时写 []。',
  'shape:evidenceRefs': 'evidenceRefs 必须是非空的字符串数组，只能写本次实际引用的证据句柄。',
  'direction-horizons-incomplete': 'directions 必须恰好 short、medium、long 各一条，不得缺失、重复或多出。',
  'direction-evidence-mismatch': 'directions 的 evidenceRefIds 只能引用输入证据里的原文句柄（例如 e7），不得改写或编造。',
  'unknown-reference': 'factId 与 evidenceRefIds 只能写输入里给出的 f# / e# 原文句柄，不得改写、拼接或编造。',
  'unknown-calendar-event': 'nextCatalysts 里的 calendarEventKey 必须逐字照抄输入 facts 里那条日历事实的 calendarEventKey（例如 US.CPI.RELEASE.2026-M08）。对不上会被整份拒绝；这条催化剂不指向日历上某一场时，直接把 calendarEventKey 这个键删掉，不要自己编一个。',
  'fact-evidence-mismatch': '每条 knownFact 只能引用它自己的那一个 evidenceRef；marketReaction 的 evidenceRefIds 必须恰好覆盖它 factIds 对应的证据集合，多一个也会被拒绝。',
  'ineligible-market-reaction': 'marketReaction 的 factIds 只能取自输入里的 marketReactionFactRefs；输入没有该字段或为空时写 []。',
  'sentiment-not-weighed': '输入里有「新闻舆情」事实，但结论没有引用任何一条。请在 knownFacts 或 supportingEvidence 中至少引用一条舆情事实，并说明它与当前判断的关系。',
  'policy-probability-citation': '结论里的政策概率取整到整百分点写（输入 X% 时写「约 round(X)%」或直接写取整后的整数），并在同一段写出该概率的截至时刻（例如「市场定价 X%，截至 YYYY-MM-DD HH:mm UTC」，X 用输入里那条事实的值，不要照抄示例数字）；更精确的值留在记录里，不在正文重复。「概率/定价」附近的百分数只能取自输入里的概率事实，不得换档或编造；正文里的数值必须带符号（写「-2.92%」，不要写「下跌 2.92%」），数字只写完整小数或四舍五入到整数、不许截断；输入没有 24 小时变化时写「24 小时变化尚未可得」，不得自己算。',
  // The answer must return to the change that triggered the run, not to a better-writable topic.
  'divergence-contradiction': '上一次 `divergences` 里的立场与输入事实相反：输入里 `divergence-<pairId>` 事实存在，说明这一对的背离成立，`stance` 只能是 diverging；反过来，事实值是 none（查过、没背离）时不能写 diverging。与证据相反会被整份拒绝——**不写不算相反**，没意见就不要写这一项。',
  'shape:divergences': '`divergences` 是可选数组；写的话每项必须恰好包含 pairId 与 stance 两个键，pairId 取输入里 `divergence-<pairId>` 的原文，stance 只能是 diverging 或 not-diverging。',
  'missing-trigger-focus': '上一次结论没有回答触发它的那条变化：请在 supportingEvidence / marketReaction / directions 里引用那条变化的证据，并在 conclusion.change 或 conclusion.causalChain 里写出该事实的名字（照输入里的写法，不要改写）。不要换一个更好写的话题。'
})

function repairInstruction(defect: Readonly<{ errorCode: string; rule?: string }>): string {
  const rule = defect.rule ?? ''
  if (rule.startsWith('shape:top-level')) return repairInstructions['shape:top-level']!
  if (defect.errorCode === MARKET_ANALYSIS_ERROR_CODES.invalidJson) return repairInstructions['invalid-json']!
  return repairInstructions[rule] ?? '上一次输出未通过校验。'
}

/**
 * The rejected answer, bounded, so the model can see what it has to correct.
 *
 * An `assistant` turn also keeps the conversation alternating for providers that reject two
 * consecutive `user` messages. It is truncated: a rejected 30KB answer would spend the context the
 * repair needs, and the defect sentence already names the failing part.
 */
function rejectedAnswer(output: unknown): StructuredModelMessage | undefined {
  try {
    const text = JSON.stringify(output)
    if (!text || text === '{}') return undefined
    const limit = 4_000
    return { role: 'assistant', content: text.length > limit ? `${text.slice(0, limit)}…` : text }
  } catch {
    return undefined
  }
}

export function repairMessage(defect: Readonly<{ errorCode: string; rule?: string }>, previous?: unknown): StructuredModelMessage[] {
  const answer = previous === undefined ? undefined : rejectedAnswer(previous)
  return [
    ...(answer ? [answer] : []),
    { role: 'user', content: `${repairInstruction(defect)}请重新输出同一个 JSON 对象：只输出 JSON，不加 Markdown；不增加、不删除字段；必要时压缩每个数组的条数，确保 JSON 完整闭合。事实与证据只能引用输入里给出的 factRef / evidenceRef 原文。` }
  ]
}

