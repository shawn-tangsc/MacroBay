import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { StructuredModelMessage } from '@platform/ai/invocation/structuredModelInvocationTypes'

import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages, type AnalysisSessionInput, type AnalysisPromptExtras } from './analysisModelPrompt'
import type { SignificanceSignal } from './significanceChangeMatcher'

/**
 * 新闻线的提示词（R39 B 笔从市场提示词搬来，C 笔会换成新契约的三段式）。
 *
 * 搬而不是删：A 笔之后、C 笔之前，按条解读仍要在读者面前工作。市场线不再认识
 * `snapshot.trigger`——触发段、`triggeredNews` 选项与 trigger 注入都只在这里组装，
 * 市场线 `buildMessages` 即使拿到带 trigger 的快照也不会产出这一段（守卫用例
 * `analysisModelPrompt.triggerIsolation.test.ts`）。
 */
const NEWS_TRIGGER_RULES: readonly string[] = [
  '本次运行由**一条新闻**触发：用户消息 trigger 段指向的就是它——`trigger.fact` 是那条事实的完整内容（方向、强度、置信度、新闻标题、源摘录），`trigger.factRef` / `trigger.evidenceRef` 是它的句柄。facts 列表里同 factRef 的那条是它的投影（长文本被截短），要以 trigger 段为准。这一段是必答的，不是背景。四件事都要写：',
  // 用户 2026-11-18 定的三段式：**主语顺序变了**——先讲新闻、再讲数据变化、最后讲未来。
  '整篇按**三段**写，一段一件事，顺序不许调换：',
  '**第一段（第一段只讲这条新闻）：** `conclusion.summary` 的主语必须是这条新闻，不是市场。用读者看得懂的话说清三件——谁做了什么、为什么这事跟加密市场有关、它偏向哪一边。**不许**在这一段堆市场条件（现在常犯的错是摘要里全是「ETF 净流出 + 杠杆去化 + 加息定价」，新闻只在从句里出现一次）。这一段仍然必须与 `trigger.fact` 的原文一致：方向、状态（在持续 / 已经结束 / 由流出转为流入）、数量照原文；拿不准就不写细节。',
  '**第二段（再用库里的数据解释现在发生了什么变化）：** `conclusion.change` 写这次相对上一份快照哪些读数动了，并回答「这些变化是在**印证**还是**反驳**第一段里那件事」；至少两条读数，两项互相矛盾就直说「这两项打架」。这一段**可以也应该提到那條新闻**（作为对照对象），但**不许复述新闻的细节**，也不许出现「信息增量来自…」「变化段为空」这类过程话。',
  '**第三段（最后给对未来的看法）：** 短期偏多 / 偏空 / 震荡 + 一句为什么 + 该盯什么（一个价位或一个读数）+ 什么情况下这个看法作废。这些落在既有字段上，不新造：方向写 `directions`（三个周期各一条），要盯的写 `nextCatalysts`，成立条件写 `conclusion.conditions`，作废条件写 `conclusion.newsImpact.invalidation`（`kind: "fact"` + `factId` + `relation`，或 `kind: "instant"` + `at`，且必须指到快照里真的有的东西，不许写没有出处的价位）。',
  '② 它影响哪个标的（BTC 或 ETH）：在第一段用一句话点明，不单独成句。',
  '③ 印证或否证必须结构化：`conclusion.newsImpact` 取 `verdict: "evaluated"`，`checks` 至少两条、每条都取非舆情事实的 factRef，`effect` 写 supports 或 contradicts；两种都有时 `contradiction` 必须为 true，只有一种时为 false；`checks` 里的事实至少要跨两个不同读数——同一读数写两遍不算两条。这与第二段的叙述是同一件事的两种表达，不许互相矛盾。',
  '④ 上面三段的角色不许混：第一段不写市场条件、第二段不重复新闻细节、第三段不重复前两段已经说过的判断。**同一条事实在一条解读里只出现一次**，宁短不长。',
  // 两条拒收判据从第一版就在，删掉它们等于把校验器的要求从提示词里拿掉。
  '这一段**不要照抄标题**，也不要通篇复述新闻：第一段是一句话的判断，不是摘要。',
  '这一条新闻的证据**必须出现在论证区**：把 `trigger.evidenceRef` 填进 supportingEvidence 的 evidenceRefId，或 marketReaction / directions 的 evidenceRefIds 之一（只挂进顶层 evidenceRefs 清单不算回答）；同时 `conclusion.change` 或 `conclusion.causalChain` 里要写出 `trigger.subject` 这个标的名称本身（照字面写，例如 BTC、ETH）。这两处缺一处，整篇都会被判为「没回答触发它的那条新闻」并拒收。',
  '如果确实查不出传导链：`verdict: "no-transmission"`，`checkedFactIds` 至少两条（写明查过哪些事实）、`reason` 一句话说明为什么没有传导。',
  '如果缺关键信息：`verdict: "cannot-determine"`，`missing.item` 只能是 amount / symbol / time / market-data，`missing.state` 只能是 not-yet / source-empty / unreadable；**不许自造同义词，也不许用「信息不足」一句代替**。',
  '三条禁止：不许只复述新闻；不许硬贴利好利空（方向必须由数据与机制给出）；不许把新闻里的金额直接当成市场影响——金额要变成市场影响，必须经过一个市场变量（资金流、成交、持仓、费率），并把那条变量写出来。',
  '来源归属要自然，别把它当每段的固定前缀：默认写「该消息称」「报道称」「据该报道」（英文 the report said / according to the report）；只有当来源确实是页面抓取、没有署名时，才写「该页面显示」（the page shows）。整条解读里来源归属**最多出现一次**——第一次交代清楚，后面直接讲事实与传导，不要每段重新挂一遍前缀；也**不得**写成「某方宣布」「官方表示」（announced / officially stated）这种把内容升格成既成事实的口径，只有官方机构自己的材料才可以写主体宣布。',
  '**摘要里关于这条新闻的陈述，必须与 trigger.fact 的原文一致**：方向、状态（在持续 / 已经结束 / 由流出转为流入）、数量都照原文，不许改写成一厢情愿的版本——新闻说某段流出**结束**了，摘要就不能写它还**在持续**。摘要与 causalChain 之间同样不许互相矛盾；拿不准的部分**就不写**，只写方向与影响，不要把没把握的细节塞进第一行。',
  '`conclusion.newsImpact` 只在这种由新闻发起的运行里出现；其它运行不要写这个字段。'
]

/** 触发型运行的 change 规则：change 是差异，不是这次的原因。 */
const NEWS_CHANGE_RULE = '? \'输入 change 段只是相对上一次快照的差异，**不是**本次运行的原因：本次运行由 trigger 段那条新闻触发。change 仍要照实写进 conclusion.change（不得编造、也不得当作没有变化），但它不能代替对那条新闻的回答。\''

export function buildNewsAnalysisMessages(
  snapshot: EvidenceSnapshot,
  significanceSignals: readonly SignificanceSignal[] = [],
  session?: AnalysisSessionInput,
  proseLanguage?: AppLanguage
): StructuredModelMessage[] {
  const trigger = snapshot.trigger
  const triggerFact = trigger ? (snapshot.facts ?? []).find(fact => fact.factId === trigger.factId) : undefined
  // 没有触发指针就不是一条新闻解读：此时新闻线退化成市场线的提示词，不追加任何触发规则。
  const extras: AnalysisPromptExtras = {
    ...(trigger ? { systemRules: NEWS_TRIGGER_RULES, changeRule: NEWS_CHANGE_RULE, includeNewsImpact: true } : {}),
    ...(trigger && triggerFact ? {
      trigger: {
        factId: triggerFact.factId,
        evidenceRefId: triggerFact.evidenceRefId ?? null,
        ...(triggerFact.subject ? { subject: triggerFact.subject } : {}),
        fact: typeof triggerFact.value === 'string' ? triggerFact.value : String(triggerFact.value ?? '')
      }
    } : {})
  }
  return buildAnalysisMessages(snapshot, significanceSignals, session, proseLanguage, extras)
}
