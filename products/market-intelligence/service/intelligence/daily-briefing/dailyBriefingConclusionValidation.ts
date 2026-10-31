import type {
  BriefingConclusionSynthesis,
  BriefingCounterEvidence,
  BriefingPriorConclusion,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import {
  detectPriorConclusionConflict,
  isConclusionDirection,
  isCopiedConclusionText
} from './dailyBriefingPriorConclusions'
import { briefingDataFactIds } from './dailyBriefingDataSelection'
import { buildNumericFactWhitelist, findUnknownNumber } from './dailyBriefingNumericFacts'

export type ConclusionSynthesisFailure =
  | 'invalid-conclusion-synthesis'
  | 'missing-conclusion-synthesis'
  | 'copied-conclusion'
  | 'missing-conclusion-evidence'
  | 'missing-conclusion-divergence'
  | 'missing-forward-view'
  | 'missing-mechanism'
  | 'data-only-summary'
  | 'missing-outlook'
  | 'repeated-direction'
  | 'forbidden-content'
  | 'forbidden-forecast'
  | 'invalid-number-format'
  | 'unknown-number'

export type ConclusionSynthesisValidation =
  | Readonly<{ ok: true; value: BriefingConclusionSynthesis }>
  | Readonly<{ ok: false; failureCode: ConclusionSynthesisFailure; detail?: string }>

const maximumSummaryLength = 600
const maximumFieldLength = 300
const maximumListItemLength = 240
const maximumEvidenceRefs = 8
const maximumConditions = 3
const maximumCounterEvidence = 3
const maximumWatchItems = 4
const maximumListItems = 4
const maximumRationaleLength = 200

/**
 * Wording that only makes sense to the system that produced the brief.
 *
 * The conclusion is read by a trader who never saw the packet: a window, a vote count, frozen data,
 * an earlier AI view or a process clock time explains the machinery, not the market. Each pattern
 * carries the concrete replacement the repair round must use.
 */
const internalWordingPatterns: readonly Readonly<{ pattern: RegExp; repair: string }>[] = [
  { pattern: /窗口/, repair: 'name the day or session and the market move instead' },
  { pattern: /多数(?:判断|观点|结论|看法)|大部分(?:判断|观点|结论|看法)/, repair: 'state the market fact that carries the day, not a vote count' },
  { pattern: /冻结(?:数据|快照|事实|文档)/, repair: 'cite the actual release or flow and its number' },
  { pattern: /前提[^。；;!?]{0,6}削弱/, repair: 'say which price, flow or print changed and by how much' },
  { pattern: /(?<![A-Za-z])AI(?![A-Za-z])|人工智能/, repair: 'describe the market, not who produced an earlier view' },
  { pattern: /模型/, repair: 'describe the market, not the forecasting tool' },
  { pattern: /结论/, repair: 'state the call and its drivers directly' },
  { pattern: /时间线/, repair: 'drop the chronology; keep only the market event that matters' },
  { pattern: /\b(?:windows?)\b(?!\s+dressing)/i, repair: 'name the day or session and the market move instead' },
  { pattern: /\b(?:most|majority)\s+(?:of\s+)?(?:the\s+)?(?:calls?|views?|judg[ae]?ments?|conclusions?)\b/i, repair: 'state the market fact that carries the day, not a vote count' },
  { pattern: /\bfrozen\s+(?:data|snapshot|facts?|document)\b/i, repair: 'cite the actual release or flow and its number' },
  { pattern: /\bpremises?\b[^.]{0,30}\b(?:weakened|undermined)\b|\b(?:weakened|undermined)\s+premises?\b/i, repair: 'say which price, flow or print changed and by how much' },
  { pattern: /\bmodels?\b/i, repair: 'describe the market, not the forecasting tool' },
  { pattern: /\bconclusions?\b/i, repair: 'state the call and its drivers directly' },
  { pattern: /\btimelines?\b/i, repair: 'drop the chronology; keep only the market event that matters' }
]

/**
 * Labels that say nothing until they name the object that moved and the number it moved by. The
 * same sentence must carry a concrete market object or a number, otherwise the label is filler.
 */
const vagueWordingTerms = [
  '分化', '承压', '风险偏好', '流动性',
  'divergence', 'under pressure', 'risk appetite', 'liquidity'
] as const

const concreteAnchorPattern = /稳定币|美元|美债|国债|收益率|利率|资金费率|净流入|净流出|现货|期货|期权|比特币|以太坊|美联储|降息|加息|纳斯达克|标普|黄金|原油|美元指数|\b(?:etf|btc|eth|stablecoins?|dollars?|treasur(?:y|ies)|yields?|rates?|funds?|exchanges?|on-chain|open interest|funding|inflows?|outflows?|spot|futures|options|bitcoins?|ether|fed|nasdaq|s&p|gold|oil|dxy)\b/i

const clockTimePattern = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/
const marketEventPattern = /CPI|PCE|GDP|PMI|FOMC|非农|议息|美联储|利率决议|公布|发布|数据|财报|开盘|收盘|盘前|盘后|拍卖|结算|交割|减半|升级|硬分叉|release|print|data|report|open|close|auction|settlement|decision|meeting|announcement|payrolls|inflation/i

/**
 * A forward view, not a recap. The family is deliberately wide because the requirement is "say
 * what happens next", not a particular phrasing; the repair hint names the required vocabulary.
 */
const forwardViewPattern = /未来|接下来|基准情形|后市|明日|今后|展望|若|一旦|假若|\bnext\b|\bbase\s+case\b|\bif\b|\bgoing\s+forward\b|\bover\s+the\s+next\b/i

/**
 * The mechanism chain: what changed → through what channel → BTC/ETH pressure or support. A
 * conclusion that only lists releases and moves has no link between them and is rejected.
 */
const mechanismPattern = /因为|由于|导致|使得|进而|通过|传导|推动|压制|带动|引发|造成|驱动|\bbecause\b|\bleads?\s+to\b|\bled\s+to\b|\bleading\s+to\b|\bthrough\b|\bdriven\s+by\b|\bdrives?\b|\bpushes?\b|\bweighs?\s+on\b|\btransmits?\b/i

const outlookStancePattern = /偏多|偏空|震荡|区间|看多|看空|中性|\b(?:bullish|bearish|range|choppy|sideways|neutral)\b/i
const relativeStrengthPattern = /强于|弱于|跑赢|跑输|优于|落后|相对更强|相对更弱|更抗跌|领涨|领跌|\b(?:outperform(?:s|ed|ing)?|underperform(?:s|ed|ing)?|stronger|weaker|relative\s+strength)\b/i
const conditionalPattern = /若|如果|一旦|假如|假若|除非|\bif\b|\bwhen\b|\bunless\b/i

/**
 * Prohibited forecasts. Directional calls and conditions are the point; a price target, a trade
 * instruction or an invented probability is not. Precision is the tell: a fabricated `70%` claim
 * dresses an opinion as a measurement.
 */
const forbiddenForecastPatterns: readonly Readonly<{ pattern: RegExp; repair: string }>[] = [
  { pattern: /目标价|目标位|目标价位|上看|下看|止盈|止损/, repair: 'drop the price target or trade instruction; state the direction, the mechanism and the condition that would flip it instead' },
  { pattern: /\b(?:price\s+target|target\s+price|stop[-\s]?loss|take[-\s]?profit)\b/i, repair: 'drop the price target or trade instruction; state the direction, the mechanism and the condition that would flip it instead' },
  { pattern: /建议\s*(?:买入|卖出|加仓|减仓|做多|做空)|(?:买入|卖出|加仓|减仓)\s*建议/, repair: 'drop the recommendation; write the directional bias and the condition that would invalidate it' },
  { pattern: /\b(?:buy|sell|long|short)\s+(?:btc|eth|bitcoin|ether|ethereum|the\s+dip)\b/i, repair: 'drop the recommendation; write the directional bias and the condition that would invalidate it' },
  { pattern: /(?:概率|可能性)\s*(?:为|约|大约|有)?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%\s*(?:的)?(?:概率|可能性)|\b\d+(?:\.\d+)?\s*%\s*(?:probability|chance|odds|likely)\b/i, repair: 'drop the invented probability; use a conditional ("若/if … 则/then …") instead' }
]

type ConclusionProseField = Readonly<{ field: string; text: string }>

/**
 * Validates the editorial model's forward-looking synthesis over the window's prior conclusions.
 *
 * The rules encode the product promise: the daily conclusion is a new verdict with a next-1-3-day
 * base case, not a recap; its mechanism chain links what changed to BTC/ETH; its premises and
 * falsifiers are derived here rather than inherited from the earlier analysis; and every number is
 * the fact's own display spelling, never a re-formatted or invented one.
 */
export function validateConclusionSynthesis(
  raw: unknown,
  document: DailyBriefingDocument,
  priorConclusions: readonly BriefingPriorConclusion[]
): ConclusionSynthesisValidation {
  if (priorConclusions.length === 0) return fail('missing-conclusion-synthesis')
  if (raw === undefined) return fail('missing-conclusion-synthesis')
  if (!isRecord(raw)) return fail('invalid-conclusion-synthesis')
  const expected = ['direction', 'confidence', 'summary', 'outlook', 'conditions', 'counterEvidence', 'watch', 'regimeChange', 'confirmed', 'refuted', 'coreTension', 'whatWouldChange', 'evidenceRefs']
  if (Object.keys(raw).length !== expected.length || !expected.every((key) => key in raw)) return fail('invalid-conclusion-synthesis')
  if (!isConclusionDirection(raw.direction)) return fail('invalid-conclusion-synthesis')
  if (raw.confidence !== 'high' && raw.confidence !== 'medium' && raw.confidence !== 'low') return fail('invalid-conclusion-synthesis')
  const summary = boundedText(raw.summary, maximumSummaryLength)
  if (summary === false) return fail('invalid-conclusion-synthesis')
  const outlook = boundedText(raw.outlook, maximumFieldLength)
  if (outlook === false) return fail('invalid-conclusion-synthesis')
  const regimeChange = boundedText(raw.regimeChange, maximumFieldLength)
  if (regimeChange === false) return fail('invalid-conclusion-synthesis')
  const coreTension = boundedText(raw.coreTension, maximumFieldLength)
  if (coreTension === false) return fail('invalid-conclusion-synthesis')
  const whatWouldChange = boundedText(raw.whatWouldChange, maximumFieldLength)
  if (whatWouldChange === false) return fail('invalid-conclusion-synthesis')
  const conditions = boundedList(raw.conditions, maximumConditions, maximumListItemLength)
  if (conditions === false || conditions.length === 0) return fail('invalid-conclusion-synthesis')
  const counterEvidence = boundedList(raw.counterEvidence, maximumCounterEvidence, maximumListItemLength)
  if (counterEvidence === false || counterEvidence.length === 0) return fail('invalid-conclusion-synthesis')
  const watch = boundedList(raw.watch, maximumWatchItems, maximumListItemLength)
  if (watch === false || watch.length === 0) return fail('invalid-conclusion-synthesis')
  const confirmed = textList(raw.confirmed)
  if (confirmed === false) return fail('invalid-conclusion-synthesis')
  const refuted = textList(raw.refuted)
  if (refuted === false) return fail('invalid-conclusion-synthesis')
  const evidenceRefs = evidenceReferences(raw.evidenceRefs, document)
  if (evidenceRefs === false) return fail('invalid-conclusion-synthesis')
  if (evidenceRefs.length === 0) return fail('missing-conclusion-evidence')
  // The summary is read as market prose, not as a status report about the synthesis. Internal
  // vocabulary and bare labels fail here with a repair hint that names the concrete replacement.
  const wording = bannedConclusionWording([
    { field: 'summary', text: summary },
    { field: 'outlook', text: outlook },
    { field: 'regimeChange', text: regimeChange },
    { field: 'coreTension', text: coreTension },
    { field: 'whatWouldChange', text: whatWouldChange },
    ...conditions.map((text) => ({ field: 'conditions', text })),
    ...counterEvidence.map((text) => ({ field: 'counterEvidence', text })),
    ...watch.map((text) => ({ field: 'watch', text })),
    ...confirmed.map((text) => ({ field: 'confirmed', text })),
    ...refuted.map((text) => ({ field: 'refuted', text }))
  ])
  if (wording) return fail('forbidden-content', wording)
  // The conclusion is prose about the window's claims; it can never copy them word for word. The
  // fact-layer conclusion is included because on a one-conclusion window it *is* the prior claim.
  const copyCandidates = [
    ...priorConclusions.flatMap((conclusion) => [
      conclusion.summary,
      ...(conclusion.rationale ? [conclusion.rationale] : [])
    ]),
    ...(document.conclusion ? [document.conclusion.summary, document.conclusion.translation ?? ''] : [])
  ].filter((text) => text.trim().length > 0)
  if (isCopiedConclusionText(summary, copyCandidates)) return fail('copied-conclusion', 'summary')
  if (isCopiedConclusionText(outlook, copyCandidates)) return fail('copied-conclusion', 'outlook')
  if (isCopiedConclusionText(regimeChange, copyCandidates)) return fail('copied-conclusion', 'regimeChange')
  const prose = [summary, outlook, regimeChange, coreTension, whatWouldChange, ...conditions, ...counterEvidence, ...watch, ...confirmed, ...refuted].join('\n')
  const forecast = forbiddenForecast(prose)
  if (forecast) return fail('forbidden-forecast', forecast)
  const numberFormat = invalidNumberFormat(prose, document.edition.locale)
  if (numberFormat) return fail('invalid-number-format', numberFormat)
  const unknownNumber = unknownNumberIn(prose, document)
  if (unknownNumber) return fail('unknown-number', unknownNumber)
  // The direction is already rendered as a tag before the summary; opening with it repeats chrome.
  if (startsWithDirectionLabel(summary)) return fail('repeated-direction', 'summary')
  // The reader buys a view of the next few sessions. A recap with no forward marker, no causal
  // link, or fewer than two sentences is the failure this validator exists to catch.
  if (!forwardViewPattern.test(summary)) {
    return fail('missing-forward-view', 'summary: add the next-1-3-day base case (未来/接下来/基准情形/若/一旦 or next/base case/if).')
  }
  if (!mechanismPattern.test(summary)) {
    return fail('missing-mechanism', 'summary: link what changed to BTC/ETH through a channel (因为/导致/通过 or because/leads to/through).')
  }
  if (sentenceCount(summary) < 2) {
    return fail('data-only-summary', 'summary: a recital of numbers is not a conclusion; add the mechanism and the forward view.')
  }
  if (!outlookStancePattern.test(outlook)) {
    return fail('missing-outlook', 'outlook: state the next-1-3-day bias explicitly (偏多/偏空/震荡 or bullish/bearish/range).')
  }
  if (!relativeStrength(outlook)) {
    return fail('missing-outlook', 'outlook: compare BTC with ETH (强于/弱于/跑赢/跑输 or outperform/underperform).')
  }
  for (const entry of counterEvidence) {
    if (!conditionalPattern.test(entry)) return fail('missing-outlook', 'counterEvidence: every falsifier must be a condition ("若/if … then …").')
    if (!/\d/.test(entry)) return fail('missing-outlook', 'counterEvidence: name the observable threshold with its FACTS number.')
  }
  for (const entry of watch) {
    if (!/\d/.test(entry)) return fail('missing-outlook', `watch: "${entry}" needs the FACTS display value a trader would watch.`)
  }
  if (!/\d/.test(whatWouldChange)) return fail('missing-outlook', 'whatWouldChange: name the observable threshold with its FACTS number.')
  // Conflict is a fact about the window, not a tone choice. If the AI views disagreed or flipped,
  // the synthesis has to name it; silently landing between them is the average this rejects.
  const conflict = detectPriorConclusionConflict(priorConclusions)
  if (conflict !== 'none' && !acknowledgesMarketReversal(prose)) return fail('missing-conclusion-divergence', conflict)
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      direction: raw.direction,
      confidence: raw.confidence,
      summary,
      outlook,
      conditions: Object.freeze(conditions.map((item) => item.trim())),
      counterEvidence: Object.freeze(counterEvidence.map((item) => item.trim())),
      watch: Object.freeze(watch.map((item) => item.trim())),
      regimeChange,
      confirmed: Object.freeze(confirmed.map((item) => item.trim())),
      refuted: Object.freeze(refuted.map((item) => item.trim())),
      coreTension,
      whatWouldChange,
      evidenceRefs: Object.freeze(evidenceRefs)
    })
  })
}

/**
 * True when a summary carries a next-1-3-day view. The editorial layer reads this before it maps
 * premises and falsifiers onto the published conclusion: a recap alone must not render the
 * "conditions"/"counter evidence" blocks that belong to a forecast.
 */
export function hasBriefingForecast(summary: unknown): boolean {
  return typeof summary === 'string' && forwardViewPattern.test(summary)
}

/**
 * The basis blocks the published conclusion may render.
 *
 * A forecast's own premises and falsifiers replace whatever the earlier analysis conclusion said:
 * that call had a different horizon, so reusing its conditions would present old reasoning as if it
 * still supported today's view. A legacy recap with no forward view renders no basis at all rather
 * than inheriting them.
 */
export function briefingConclusionBasis(synthesis: BriefingConclusionSynthesis): Readonly<{
  conditions: readonly string[]
  counterEvidence: readonly BriefingCounterEvidence[]
  invalidations: readonly Readonly<{ asset: 'BTC' | 'ETH'; horizonEnd: string; text: string }>[]
}> {
  if (!hasBriefingForecast(synthesis.summary)) {
    return Object.freeze({
      conditions: Object.freeze([]),
      counterEvidence: Object.freeze([]),
      invalidations: Object.freeze([])
    })
  }
  return Object.freeze({
    conditions: Object.freeze([...synthesis.conditions]),
    counterEvidence: Object.freeze(synthesis.counterEvidence.map((statement) => Object.freeze({
      statement,
      citations: Object.freeze([]) as readonly number[]
    }))),
    invalidations: Object.freeze([])
  })
}

/**
 * A window whose earlier reads disagreed still has to say what changed, but in market language:
 * a move that reversed, a bid that faded, a call that was overturned. Naming the process or the
 * chronology ("the view flipped during the window") is the meta-narration this rejects.
 */
export function acknowledgesMarketReversal(text: string): boolean {
  return /转多|转空|转为(?:看多|看空|偏多|偏空)|翻多|翻空|回到(?:偏多|偏空|看多|看空)|逆转|反转|扭转|改判|推翻|证伪|先[^。；;]{0,24}后|由[^。；;]{0,24}(?:转为|变成|回到|跌至|升至)|\bturn(?:ed|s|ing)?\b|\bflipp(?:ed|ing)\b|\brevers(?:ed|al|ing)\b|\bback to\b|\bfrom\b[^.]{0,40}\bto\b|\bfaded\b|\bgave back\b|\bwalked back\b/i.test(text)
}

function forbiddenForecast(prose: string): string | undefined {
  for (const { pattern, repair } of forbiddenForecastPatterns) {
    const match = pattern.exec(prose)
    if (match) return `"${match[0]}" is a prohibited forecast; ${repair}.`
  }
  return undefined
}

/**
 * Rejects a number the prose formatted itself instead of quoting the fact's `display`.
 *
 * The reader must be able to compare two editions: the same flow cannot be `-6.43 亿美元` one day
 * and `-643200000 美元` the next. Chinese prose uses 亿/万美元, English prose uses $B/$M, and no
 * percentage carries more than two decimals.
 */
function invalidNumberFormat(text: string, locale: 'zh-CN' | 'en-US'): string | undefined {
  const excessPercent = /-?\d+\.\d{3,}\s*%/.exec(text)
  if (excessPercent) return `"${excessPercent[0]}" keeps more than two decimals; quote the FACTS display value (for example -0.83%).`
  const rawAmount = /(?<![\d.,])\d{9,}(?:\.\d+)?(?![\d.,])/.exec(text)
  if (rawAmount) return `"${rawAmount[0]}" is a raw amount; quote the FACTS display value (for example -6.43 亿美元 / -$643.2M).`
  const groupedAmount = /(?<![\d.,])\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?(?![\d.,])/.exec(text)
  if (groupedAmount) return `"${groupedAmount[0]}" is a raw amount with separators; quote the FACTS display value (for example -6.43 亿美元 / -$643.2M).`
  const spelledMagnitude = /\b\d+(?:\.\d+)?\s*(?:billion|million)\b/i.exec(text)
  if (spelledMagnitude) return `"${spelledMagnitude[0]}" is not the fact display; quote it as 亿/万美元 or $B/$M.`
  if (locale === 'zh-CN') {
    const englishUnit = /\$\s?\d|\b(?:billion|million)\b/i.exec(text)
    if (englishUnit) return `"${englishUnit[0]}" is an English money unit in Chinese prose; quote the FACTS display value in 亿/万美元 (for example -6.43 亿美元).`
  } else {
    const chineseUnit = /亿|万|美元/.exec(text)
    if (chineseUnit) return `"${chineseUnit[0]}" is a Chinese unit in English prose; quote the FACTS display value in $B/$M (for example -$643.2M).`
  }
  return undefined
}

/**
 * Numbers may repeat a fact's raw value or its display spelling, never a quantity the document
 * does not carry. The whitelist already carries both spellings, because it derives the display
 * values from the same rows the prompt exposes.
 */
function unknownNumberIn(prose: string, document: DailyBriefingDocument): string | undefined {
  const numericProse = prose.replace(/\b\d{1,2}:\d{2}\b/g, ' ')
  return findUnknownNumber(numericProse, buildNumericFactWhitelist(document))
}

function startsWithDirectionLabel(summary: string): boolean {
  return /^\s*(?:结论|方向)?\s*[：:]?\s*(?:偏多|偏空|震荡|看多|看空|中性|bullish\b|bearish\b|range\b|neutral\b|mixed\b)/i.test(summary)
}

function relativeStrength(outlook: string): boolean {
  return /\bBTC\b/i.test(outlook) && /\bETH\b/i.test(outlook) && relativeStrengthPattern.test(outlook)
}

function sentenceCount(text: string): number {
  return splitSentences(text).length
}

/**
 * Returns the repair hint for the first internal or vague phrase, or `undefined` when the prose is
 * reader-facing. The hint is the whole repair instruction: the turn appends the failure detail to
 * its repair message, so it must state what to write instead, not just what was wrong.
 */
function bannedConclusionWording(fields: readonly ConclusionProseField[]): string | undefined {
  for (const { field, text } of fields) {
    for (const { pattern, repair } of internalWordingPatterns) {
      const match = pattern.exec(text)
      if (match) {
        return `${field}: "${match[0]}" is internal process language; ${repair}. Rewrite it as the market event or data, its number from FACTS, and the date.`
      }
    }
  }
  for (const { field, text } of fields) {
    for (const term of vagueWordingTerms) {
      const sentence = sentenceContaining(text, term)
      if (!sentence) continue
      if (hasConcreteAnchor(sentence, term)) continue
      return `${field}: "${term}" is too vague on its own; name the concrete market object and the number it moved by, both from FACTS, in the same sentence.`
    }
  }
  for (const { field, text } of fields) {
    for (const sentence of splitSentences(text)) {
      const match = clockTimePattern.exec(sentence)
      if (!match || marketEventPattern.test(sentence)) continue
      return `${field}: "${match[0]}" is a process timestamp; write the scheduled market event by name (for example "20:30 CPI") or drop the clock time.`
    }
  }
  return undefined
}

function sentenceContaining(text: string, term: string): string | undefined {
  const needle = term.toLowerCase()
  return splitSentences(text).find((sentence) => sentence.toLowerCase().includes(needle))
}

function hasConcreteAnchor(sentence: string, term: string): boolean {
  if (/\d/.test(sentence)) return true
  const index = sentence.toLowerCase().indexOf(term.toLowerCase())
  if (index < 0) return false
  // The anchor has to sit next to the label, not merely in the same sentence: "流动性收紧" is
  // filler even when an unrelated price is mentioned later in the sentence.
  const reach = /[\u3400-\u9fff]/.test(term) ? 12 : 40
  const start = Math.max(0, index - reach)
  const end = Math.min(sentence.length, index + term.length + reach)
  return concreteAnchorPattern.test(sentence.slice(start, end))
}

function splitSentences(text: string): readonly string[] {
  return text.split(/(?<=[。！？!?；;\n])|(?<=\.)\s+/).map((sentence) => sentence.trim()).filter(Boolean)
}

/**
 * Evidence has to be a fact id the frozen document actually carries. Prior conclusions are
 * deliberately not in this space: their assertions are claims, and citing a claim as evidence is
 * exactly the laundering the synthesis exists to stop.
 */
function evidenceReferences(
  value: unknown,
  document: DailyBriefingDocument
): readonly string[] | false {
  if (!Array.isArray(value) || value.length > maximumEvidenceRefs) return false
  const known = new Set<string>([
    ...document.news.items.map((item) => `news:${item.itemId}`),
    ...document.news.macro.map((item) => `macro:${item.eventKey}`),
    ...briefingDataFactIds(document)
  ])
  const refs: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 200) return false
    if (!known.has(entry)) return false
    if (!refs.includes(entry)) refs.push(entry)
  }
  return Object.freeze(refs)
}

function textList(value: unknown): readonly string[] | false {
  if (!Array.isArray(value) || value.length > maximumListItems) return false
  const items: string[] = []
  for (const entry of value) {
    const text = boundedText(entry, maximumRationaleLength)
    if (text === false) return false
    items.push(text)
  }
  return Object.freeze(items)
}

function boundedList(value: unknown, maximumItems: number, maximumLength: number): readonly string[] | false {
  if (!Array.isArray(value) || value.length > maximumItems) return false
  const items: string[] = []
  for (const entry of value) {
    const text = boundedText(entry, maximumLength)
    if (text === false) return false
    items.push(text)
  }
  return Object.freeze(items)
}

function boundedText(value: unknown, maximum: number): string | false {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length === 0 || text.length > maximum) return false
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(failureCode: ConclusionSynthesisFailure, detail?: string): ConclusionSynthesisValidation {
  return Object.freeze({ ok: false as const, failureCode, ...(detail ? { detail } : {}) })
}
