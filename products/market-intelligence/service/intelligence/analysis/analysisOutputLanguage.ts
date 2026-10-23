import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { marketAnalysisValidationPolicy } from './analysisConstants'

/**
 * 分析正文的输出语言。
 *
 * 机器要读的值全部是语言无关的 key（`direction: bullish`、`horizon: short`、`confidence: low`），
 * 协议里没有任何自然语言 token，所以这里只负责告诉模型**正文**用哪种语言写。语言名由
 * `Intl.DisplayNames` 解析——增加新语言时不需要新增文案表，传进来的 BCP-47 tag 就是全部输入。
 */
export function analysisProseDirective(language: AppLanguage): string {
  return [
    `输出语言：${displayLanguageName(language)}（${language}）。`,
    '所有用户可见正文都必须使用该语言书写：conclusion 的 summary、change、causalChain、conditions、macro、evidenceStrength、dataGaps，',
    '以及 knownFacts / transmissionHypotheses / marketReaction / supportingEvidence / counterEvidence / nextCatalysts 的 statement、scenarios.baseCase、directions.rationale、dataCaveats。',
    'direction、horizon、confidence、status 等枚举值必须保持契约给定的 key，不得翻译或改写。',
    analysisNumberFormatRule(language)
  ].join('')
}

/**
 * 数字与单位也必须跟随正文语言。
 *
 * 提示词里的输入事实会按同一语言预格式化，但模型仍可能照抄另一种语言的单位（英文正文里的
 * 「亿美元」就是这样出现的），所以这里再明确一次写法。
 */
export function analysisNumberFormatRule(language: AppLanguage): string {
  if (language === 'zh-CN') {
    return '数值与单位必须用中文写法：美元金额写成「4.48 亿美元」「-6.36 亿美元」，不得出现 $ 或 B/M/K 等英文单位后缀。'
  }
  return '数值与单位必须用英文写法：美元金额写成「$4.48B」「-$6.36B」（B=十亿、M=百万、K=千），不得出现「亿」「万」「美元」等中文单位，也不要写 MUSD/BUSD 这类容易与资产代码混淆的后缀。'
}

function displayLanguageName(language: string): string {
  try {
    // The base subtag keeps the name readable for regional variants ("英语" rather than "美国英语"),
    // while the full tag still appears next to it so the model knows the exact locale.
    return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(language.split('-')[0]!) ?? language
  } catch {
    return language
  }
}

/**
 * 提示词里的字段结构示例。
 *
 * 方向是 key 而不是词，所以这份示例对所有语言都是同一份：模型不需要挑选「中文版还是英文版
 * 的标记」，只需要按 `analysisProseDirective` 写正文。
 */
export function analysisPromptSchemaExample(): Record<string, unknown> {
  const policy = marketAnalysisValidationPolicy
  return {
    conclusion: {
      direction: policy.analysisDirectionKeys.join(' 或 '),
      summary: '<一句结论：当前机制与它对资产的作用方向>',
      change: '<本次数据变化：引用具体字段与数值；没有变化就写没有新变化>',
      causalChain: '<起因事件 → 中间变量 → 对该资产的作用方向 → 因此本判断成立的条件>',
      conditions: ['<一个成立条件>'],
      macro: '<宏观侧的一句话；没有就写 null>',
      evidenceStrength: '<哪一侧证据更强、为什么；没有就写 null>',
      dataGaps: ['<一个数据缺口，以及它如何影响置信度>']
    },
    knownFacts: [{ factId: '输入事实的 factRef 原文', statement: '<该事实描述>', evidenceRefIds: ['该事实的 evidenceRef 原文'] }],
    transmissionHypotheses: [{ statement: '<条件式传导假设，不能声称因果已确认>', evidenceRefIds: ['输入中的 evidenceRef 原文'] }],
    marketReaction: [{ statement: '<可比行情支持的市场反应>', factIds: ['输入中支持该反应的 factRef 原文'], evidenceRefIds: ['对应证据的 evidenceRef 原文'] }],
    supportingEvidence: [{ statement: '<支持证据描述>', evidenceRefId: '输入中的 evidenceRef 原文' }],
    counterEvidence: [{ statement: '<反向证据描述>', evidenceRefId: '输入中的 evidenceRef 原文' }],
    scenarios: [{
      asset: 'BTC 或 ETH',
      horizon: policy.scenarioHorizons.join(' 或 '),
      baseCase: '<条件式情景>',
      conditions: ['<非空成立条件>'],
      invalidation: '<失效条件>',
      status: 'pending'
    }],
    directions: [{
      horizon: policy.directionHorizons.join(' 或 '),
      direction: policy.analysisDirectionKeys.join(' 或 '),
      rationale: '<一句理由，基于本次证据>',
      confidence: policy.directionConfidences.join(' 或 '),
      evidenceRefIds: ['支撑该理由的 evidenceRef 原文']
    }],
    nextCatalysts: [{ statement: '<有证据的后续催化剂>', evidenceRefIds: ['输入中的 evidenceRef 原文'] }],
    dataCaveats: ['<输入标注的数据限制>'],
    evidenceRefs: ['本次实际引用的 evidenceRef 原文，至少一个']
  }
}
