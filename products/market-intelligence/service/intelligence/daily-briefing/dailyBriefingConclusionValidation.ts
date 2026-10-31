import type {
  BriefingConclusionSynthesis,
  BriefingPriorConclusion,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import {
  detectPriorConclusionConflict,
  isConclusionDirection,
  isCopiedConclusionText
} from './dailyBriefingPriorConclusions'
import { briefingDataFactIds } from './dailyBriefingDataSelection'

export type ConclusionSynthesisFailure =
  | 'invalid-conclusion-synthesis'
  | 'missing-conclusion-synthesis'
  | 'copied-conclusion'
  | 'missing-conclusion-evidence'
  | 'missing-conclusion-divergence'
  | 'forbidden-content'

export type ConclusionSynthesisValidation =
  | Readonly<{ ok: true; value: BriefingConclusionSynthesis }>
  | Readonly<{ ok: false; failureCode: ConclusionSynthesisFailure; detail?: string }>

const maximumSummaryLength = 600
const maximumFieldLength = 300
const maximumEvidenceRefs = 8
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

type ConclusionProseField = Readonly<{ field: string; text: string }>

/**
 * Validates the editorial model's synthesis of the window's prior conclusions.
 *
 * The rules encode the product promise: the daily conclusion is a new verdict, not a copy; it stands
 * on frozen facts, not on the conclusions it is summarizing; and a window whose AI views disagreed
 * must say so instead of averaging them into a directionless middle.
 */
export function validateConclusionSynthesis(
  raw: unknown,
  document: DailyBriefingDocument,
  priorConclusions: readonly BriefingPriorConclusion[]
): ConclusionSynthesisValidation {
  if (priorConclusions.length === 0) return fail('missing-conclusion-synthesis')
  if (raw === undefined) return fail('missing-conclusion-synthesis')
  if (!isRecord(raw)) return fail('invalid-conclusion-synthesis')
  const expected = ['direction', 'confidence', 'summary', 'regimeChange', 'confirmed', 'refuted', 'coreTension', 'whatWouldChange', 'evidenceRefs']
  if (Object.keys(raw).length !== expected.length || !expected.every((key) => key in raw)) return fail('invalid-conclusion-synthesis')
  if (!isConclusionDirection(raw.direction)) return fail('invalid-conclusion-synthesis')
  if (raw.confidence !== 'high' && raw.confidence !== 'medium' && raw.confidence !== 'low') return fail('invalid-conclusion-synthesis')
  const summary = boundedText(raw.summary, maximumSummaryLength)
  if (summary === false) return fail('invalid-conclusion-synthesis')
  const regimeChange = boundedText(raw.regimeChange, maximumFieldLength)
  if (regimeChange === false) return fail('invalid-conclusion-synthesis')
  const coreTension = boundedText(raw.coreTension, maximumFieldLength)
  if (coreTension === false) return fail('invalid-conclusion-synthesis')
  const whatWouldChange = boundedText(raw.whatWouldChange, maximumFieldLength)
  if (whatWouldChange === false) return fail('invalid-conclusion-synthesis')
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
    { field: 'regimeChange', text: regimeChange },
    { field: 'coreTension', text: coreTension },
    { field: 'whatWouldChange', text: whatWouldChange },
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
  if (isCopiedConclusionText(regimeChange, copyCandidates)) return fail('copied-conclusion', 'regimeChange')
  // Conflict is a fact about the window, not a tone choice. If the AI views disagreed or flipped,
  // the synthesis has to name it; silently landing between them is the average this rejects.
  const conflict = detectPriorConclusionConflict(priorConclusions)
  if (conflict !== 'none') {
    const prose = [summary, regimeChange, coreTension, whatWouldChange, ...confirmed, ...refuted].join('\n')
    if (!acknowledgesMarketReversal(prose)) return fail('missing-conclusion-divergence', conflict)
  }
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      direction: raw.direction,
      confidence: raw.confidence,
      summary,
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
 * A window whose earlier reads disagreed still has to say what changed, but in market language:
 * a move that reversed, a bid that faded, a call that was overturned. Naming the process or the
 * chronology ("the view flipped during the window") is the meta-narration this rejects.
 */
export function acknowledgesMarketReversal(text: string): boolean {
  return /转多|转空|转为(?:看多|看空|偏多|偏空)|翻多|翻空|回到(?:偏多|偏空|看多|看空)|逆转|反转|扭转|改判|推翻|证伪|先[^。；;]{0,24}后|由[^。；;]{0,24}(?:转为|变成|回到|跌至|升至)|\bturn(?:ed|s|ing)?\b|\bflipp(?:ed|ing)\b|\brevers(?:ed|al|ing)\b|\bback to\b|\bfrom\b[^.]{0,40}\bto\b|\bfaded\b|\bgave back\b|\bwalked back\b/i.test(text)
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
