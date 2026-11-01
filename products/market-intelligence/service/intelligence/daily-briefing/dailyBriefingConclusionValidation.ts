import type {
  BriefingConclusionSynthesis,
  BriefingCounterEvidence,
  BriefingPriorConclusion,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import {
  detectPriorConclusionConflict,
  isConclusionDirection,
  isCopiedConclusionText,
  normalizeConclusionText
} from './dailyBriefingPriorConclusions'
import { briefingDataFactIds } from './dailyBriefingDataSelection'
import { describeValue, evidenceReferenceDefect, knownEvidenceIds, listFieldDefect, textFieldDefect } from './briefingRefusalReasons'
import { buildNumericFactWhitelist, findUnknownNumber } from './dailyBriefingNumericFacts'

export type ConclusionSynthesisFailure =
  | 'invalid-conclusion-synthesis'
  | 'missing-conclusion-synthesis'
  | 'copied-conclusion'
  | 'missing-conclusion-evidence'
  | 'missing-conclusion-divergence'
  | 'missing-mechanism'
  | 'data-only-summary'
  | 'missing-outlook'
  | 'repeated-direction'
  | 'duplicate-statement'
  | 'forbidden-content'
  | 'forbidden-forecast'
  | 'invalid-number-format'
  | 'unknown-number'
  | 'asset-equality-claim'

export type ConclusionSynthesisValidation =
  | Readonly<{ ok: true; value: BriefingConclusionSynthesis }>
  | Readonly<{ ok: false; failureCode: ConclusionSynthesisFailure; detail?: string }>

import {
  maximumSummaryLength,
  maximumFieldLength,
  maximumListItemLength,
  maximumEvidenceRefs,
  maximumConditions,
  maximumCounterEvidence,
  maximumWatchItems,
  maximumListItems,
  maximumRationaleLength,
  maximumRegimeMarkerLength,
  internalWordingPatterns,
  vagueWordingTerms,
  concreteAnchorPattern,
  clockTimePattern,
  marketEventPattern,
  mechanismPattern,
  outlookStancePattern,
  relativeStrengthPattern,
  conditionalPattern,
  forbiddenForecastPatterns,
} from './dailyBriefingConclusionWording'


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
  // Every refusal names the defect, because a repair round can only fix what it can read: "invalid
  // shape" alone is the message that made a model re-send the same answer until the run gave up.
  const missing = expected.filter((key) => !(key in raw))
  const extra = Object.keys(raw).filter((key) => !expected.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    return fail('invalid-conclusion-synthesis', [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
      extra.length > 0 ? `not part of the contract: ${extra.join(', ')}` : ''
    ].filter(Boolean).join('; '))
  }
  if (!isConclusionDirection(raw.direction)) return fail('invalid-conclusion-synthesis', `direction: must be one of bullish, bearish, range, undecided, mixed (got ${describeValue(raw.direction)})`)
  if (raw.confidence !== 'high' && raw.confidence !== 'medium' && raw.confidence !== 'low') return fail('invalid-conclusion-synthesis', `confidence: must be high, medium or low (got ${describeValue(raw.confidence)})`)
  const summary = boundedText(raw.summary, maximumSummaryLength)
  if (summary === false) return fail('invalid-conclusion-synthesis', textFieldDefect('summary', raw.summary, maximumSummaryLength))
  const outlook = boundedText(raw.outlook, maximumFieldLength)
  if (outlook === false) return fail('invalid-conclusion-synthesis', textFieldDefect('outlook', raw.outlook, maximumFieldLength))
  const regimeChange = boundedText(raw.regimeChange, maximumRegimeMarkerLength)
  if (regimeChange === false) return fail('invalid-conclusion-synthesis', `regimeChange: keep the marker to one short phrase (max ${maximumRegimeMarkerLength} characters) or write 无重要变化 / "no material change".`)
  const coreTension = boundedText(raw.coreTension, maximumFieldLength)
  if (coreTension === false) return fail('invalid-conclusion-synthesis', textFieldDefect('coreTension', raw.coreTension, maximumFieldLength))
  const whatWouldChange = boundedText(raw.whatWouldChange, maximumFieldLength)
  if (whatWouldChange === false) return fail('invalid-conclusion-synthesis', textFieldDefect('whatWouldChange', raw.whatWouldChange, maximumFieldLength))
  const conditions = boundedList(raw.conditions, maximumConditions, maximumListItemLength)
  if (conditions === false || conditions.length === 0) return fail('invalid-conclusion-synthesis', listFieldDefect('conditions', raw.conditions, maximumConditions, maximumListItemLength))
  const counterEvidence = boundedList(raw.counterEvidence, maximumCounterEvidence, maximumListItemLength)
  if (counterEvidence === false || counterEvidence.length === 0) return fail('invalid-conclusion-synthesis', listFieldDefect('counterEvidence', raw.counterEvidence, maximumCounterEvidence, maximumListItemLength))
  const watch = boundedList(raw.watch, maximumWatchItems, maximumListItemLength)
  if (watch === false || watch.length === 0) return fail('invalid-conclusion-synthesis', listFieldDefect('watch', raw.watch, maximumWatchItems, maximumListItemLength))
  const confirmed = textList(raw.confirmed)
  if (confirmed === false) return fail('invalid-conclusion-synthesis', `confirmed: a list of at most ${maximumListItems} short sentences (got ${describeValue(raw.confirmed)})`)
  const refuted = textList(raw.refuted)
  if (refuted === false) return fail('invalid-conclusion-synthesis', `refuted: a list of at most ${maximumListItems} short sentences (got ${describeValue(raw.refuted)})`)
  const evidenceRefs = evidenceReferences(raw.evidenceRefs, document)
  // A refused citation list used to come back as a bare false, so a reply that cited nine facts was
  // rejected with "invalid-conclusion-synthesis" and nothing else — and the repair round cited nine
  // again. The cap is stated in the reply schema now, and the refusal names what is wrong.
  if (evidenceRefs === false) return fail('invalid-conclusion-synthesis', evidenceReferenceDefect(raw.evidenceRefs, document))
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
  const equality = assetEqualityClaim(prose, document)
  if (equality) return fail('asset-equality-claim', equality)
  // The direction is already rendered as a tag before the summary; opening with it repeats chrome.
  if (startsWithDirectionLabel(summary)) return fail('repeated-direction', 'summary')
  // Each point is rendered once: the summary states the mechanism, and the forecast fields below it
  // carry the base case, the catalysts and the overturn threshold. Repeating one of them inside the
  // summary shows the reader the same sentence twice, which reads as none of them.
  const duplicate = repeatedStatement(summary, whatWouldChange, counterEvidence, watch, outlook)
  if (duplicate) return fail('duplicate-statement', duplicate)
  // The base case has its own rendered field, so the summary carries the verdict and the mechanism
  // instead of restating the forecast; a causal link and a second sentence are still required, so a
  // bare recap is rejected.
  if (!mechanismPattern.test(summary)) {
    return fail('missing-mechanism', 'summary: link what changed to BTC/ETH through a channel (因为/导致/通过 or because/leads to/through).')
  }
  if (sentenceCount(summary) < 2) {
    return fail('data-only-summary', 'summary: a recital of numbers is not a conclusion; add the mechanism that moved BTC/ETH.')
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
 * True when the synthesis carries a next-1-3-day view. The editorial layer reads this before it maps
 * premises and falsifiers onto the published conclusion: a recap alone must not render the
 * "conditions"/"counter evidence" blocks that belong to a forecast.
 *
 * The forecast lives in `outlook` (it is rendered as its own block), not in the summary prose, so the
 * gate reads that field instead of hunting for a forward word in the summary.
 */
export function synthesisHasForecast(synthesis: Pick<BriefingConclusionSynthesis, 'outlook'>): boolean {
  return typeof synthesis.outlook === 'string' && outlookStancePattern.test(synthesis.outlook) && relativeStrength(synthesis.outlook)
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
  if (!synthesisHasForecast(synthesis)) {
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

/**
 * The same point typed twice. Comparison is on the whole normalized sentence (equality or one
 * containing the other), not on shared vocabulary: two lines may legitimately quote the same flow
 * while saying different things, but they may not be the same sentence.
 */
function repeatedStatement(
  summary: string,
  whatWouldChange: string,
  counterEvidence: readonly string[],
  watch: readonly string[],
  outlook: string
): string | undefined {
  const summaryText = normalizeConclusionText(summary)
  const repeated = (candidate: string): boolean => {
    const text = normalizeConclusionText(candidate)
    if (text.length < 12 || summaryText.length < 12) return false
    if (text === summaryText) return true
    if (text.length >= 20 && summaryText.includes(text)) return true
    return summaryText.length >= 20 && text.includes(summaryText)
  }
  if (repeated(outlook)) return 'outlook: repeats the summary; keep the mechanism in summary and put the base case only in outlook.'
  if (repeated(whatWouldChange)) return 'whatWouldChange: repeats the summary; state the single overturn threshold here and leave it out of summary.'
  for (const entry of watch) {
    if (repeated(entry)) return 'watch: repeats the summary; each catalyst is named once, in watch.'
  }
  const threshold = normalizeConclusionText(whatWouldChange)
  for (const entry of counterEvidence) {
    const falsifier = normalizeConclusionText(entry)
    if (threshold.length < 12 || falsifier.length < 12) continue
    if (threshold === falsifier || (threshold.length >= 20 && falsifier.includes(threshold)) || (falsifier.length >= 20 && threshold.includes(falsifier))) {
      return 'whatWouldChange: repeats a counterEvidence falsifier; the threshold is the single decisive number, the falsifiers are the conditions around it.'
    }
  }
  return undefined
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
/**
 * Two assets that print the same are not the same asset.
 *
 * BTC +0.5043% and ETH +0.4992% both read +0.50%, and a reply that turned that rounding into "ETH
 * matches BTC" published a coincidence as an analytical fact. The claim is refused whenever the raw
 * values differ: the reply has to say which is stronger, or drop the comparison.
 */
const assetEqualityPattern = /(?:(?:BTC|比特币)[^。；;.!?]{0,40}(?:与|和|跟|同|and|vs\.?|versus)[^。；;.!?]{0,40}(?:ETH|以太坊)|(?:ETH|以太坊)[^。；;.!?]{0,40}(?:与|和|跟|同|and|vs\.?|versus)[^。；;.!?]{0,40}(?:BTC|比特币))[^。；;.!?]{0,24}(?:相同|一致|持平|相等|一样|同步|matched|matches|matching|equal|equals|in line|the same)/i

function assetEqualityClaim(prose: string, document: DailyBriefingDocument): string | undefined {
  if (!assetEqualityPattern.test(prose)) return undefined
  const raw = (id: string): number | undefined => document.data.market.find((row) => row.id === id)?.value?.number ?? undefined
  const btc = raw('btc')
  const eth = raw('eth')
  if (typeof btc !== 'number' || typeof eth !== 'number' || btc === eth) return undefined
  return `BTC and ETH are not the same: their raw 24h values differ (${btc} vs ${eth}); the two-decimal display only rounds them together. Say which is stronger, or drop the comparison.`
}

function evidenceReferences(
  value: unknown,
  document: DailyBriefingDocument
): readonly string[] | false {
  if (!Array.isArray(value) || value.length > maximumEvidenceRefs) return false
  const known = knownEvidenceIds(document)
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
