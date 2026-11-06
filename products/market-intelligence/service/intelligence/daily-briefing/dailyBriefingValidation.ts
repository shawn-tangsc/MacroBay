import type {
  BriefingConclusionSynthesis,
  BriefingMacroItem,
  BriefingNewsItem,
  BriefingPriorConclusion,
  BriefingPulseRow,
  BriefingMarketRow,
  DailyBriefingDocument,
  FactImportance
} from '../../../contracts/dailyBriefing'
import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import {
  checkDailyBriefWebEvidence,
  createWebSearchBudget,
  dailyBriefWebSearchBudget,
  isOfficialWebSource,
  type DailyBriefWebEvidenceRef,
  type DailyBriefWebEvidenceField
} from './dailyBriefWebEvidence'
import {
  briefingDataFactIds,
  briefingDataVisibilityAudit,
  selectBriefingDataFacts,
  withEditorialReasons
} from './dailyBriefingDataSelection'
import { buildNumericFactWhitelist, findUnknownNumber } from './dailyBriefingNumericFacts'
import { validateConclusionSynthesis, briefingConclusionBasis } from './dailyBriefingConclusionValidation'
import { failAll, type DailyBriefingValidationFailureEntry, type DailyBriefingValidationFailureResult } from './dailyBriefingValidationFailures'
import { editorialProse } from './dailyBriefingValidationProse'
import { validatedNextFocus } from './dailyBriefingNextFocusValidation'
import { selectMacroAnalysisCandidates } from './dailyBriefingDocumentMacro'

export type DailyBriefingEditorialOutput = Readonly<{
  lede: string
  ledePattern?: string
  items: readonly Readonly<{ factId: string; why: string }>[]
  hidden: readonly Readonly<{ factId: string; reason: string }>[]
  webEvidence?: readonly DailyBriefWebEvidenceRef[]
  importance: readonly Readonly<{ factId: string; tier: 'must' | 'support' | 'reference'; reasonText?: string }>[]
  hiddenData: readonly Readonly<{ factId: string; reason: string }>[]
  dataNote?: string
  invalidationNote?: string
  conclusionTranslation?: string
  /** The editorial model's synthesis over the window's prior conclusions. */
  conclusionSynthesis?: BriefingConclusionSynthesis
  nextFocus?: Readonly<{
    eventKey: string
    why: string
    watch: readonly Readonly<{ condition: string; implication: string }>[]
  }>
}>

export type DailyBriefingValidationFailure =
  | 'invalid-shape' | 'direction-conflict' | 'row-set-mismatch'
  | 'unknown-fact'
  | 'forbidden-content'
  | 'unknown-number'
  | 'invalid-translation'
  | 'too-long'
  | 'missing-hidden-reason'
  | 'missing-macro-why'
  | 'invalid-macro-why'
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
  | 'forbidden-forecast'
  | 'invalid-number-format'
  | 'asset-equality-claim'

export type DailyBriefingValidation =
  | Readonly<{ ok: true; value: DailyBriefingEditorialOutput }>
  /**
   * `failures` is every independent defect this pass found, not just the first. A repair round that
   * hears only one of them spends a round on it and leaves the rest untouched — which is how three
   * writes in one evening each fixed a different field and the last one still failed on a field it
   * had never been told about.
   */
  | DailyBriefingValidationFailureResult

export type DailyBriefingEditorialMeta = Readonly<{
  promptVersion: string
  model: string
  source: 'default' | 'custom'
}>

/**
 * Accepts prose and a ranking, never a new fact. Fact ids are checked against the frozen document,
 * lengths and forbidden content are checked here, and the numeric whitelist is derived from the
 * document itself so a model cannot smuggle a price or a target into the brief.
 */
export function validateDailyBriefingEditorial(
  raw: unknown,
  document: DailyBriefingDocument,
  locale: 'zh-CN' | 'en-US',
  toolInvocations: readonly AgentRuntimeToolInvocation[] = [],
  priorConclusions: readonly BriefingPriorConclusion[] = []
): DailyBriefingValidation {
  if (!isExact(raw, ['lede', 'ledePattern', 'items', 'hidden', 'importance'], ['hiddenData', 'dataNote', 'invalidationNote', 'conclusionTranslation', 'conclusionSynthesis', 'nextFocus', 'webEvidence'])) {
    return failShape('shape')
  }
  if (typeof raw.lede !== 'string' || raw.lede.trim().length === 0) return failShape('lede')
  if (!isLedePattern(raw.ledePattern)) return failShape('ledePattern')
  if (document.lede.previousPattern && document.lede.previousPattern === raw.ledePattern) return failShape('ledePattern')
  if (raw.lede.length > 600) return fail('too-long')
  if (!Array.isArray(raw.items) || raw.items.length > 50) return failShape('items')
  if (!Array.isArray(raw.hidden)) return failShape('hidden')
  if (!Array.isArray(raw.importance)) return failShape('importance')
  if (raw.hiddenData !== undefined && !Array.isArray(raw.hiddenData)) return failShape('hiddenData')
  const issues: DailyBriefingValidationFailureEntry[] = []
  const newsIds = new Set(document.news.items.map((item) => `news:${item.itemId}`))
  // 覆盖判定只看模型见过的那些（有实际值的）：无值事件不在写作素材里，不能要求编辑替它写
  // why 或隐藏理由（`A0.12` ⑤）。
  const macroIds = new Set(selectMacroAnalysisCandidates(document.news.macro).map((item) => `macro:${item.eventKey}`))
  const dataIds = new Set(briefingDataFactIds(document))
  const items: Array<{ factId: string; why: string }> = []
  for (const item of raw.items) {
    // A shown macro must carry its explanation. This is the safety net for an editor that lists a
    // macro without a why; a macro the system did not receive a why for is never shown.
    if (isRecord(item) && typeof item.factId === 'string' && item.factId.startsWith('macro:') && !isText(item.why)) {
      return fail('missing-macro-why', item.factId)
    }
    if (!isExact(item, ['factId', 'why'])) return failShape('items[]')
    if (!isText(item.factId) || !isText(item.why)) return failShape('items.factId')
    if (item.why.length > 200) return fail('too-long')
    if (!newsIds.has(item.factId) && !macroIds.has(item.factId)) {
      // Collected, not returned: a reply can cite a fact that does not exist *and* write a field
      // wrongly, and one repair round must hear both or it fixes one and leaves the other.
      // Recorded, and then kept in place: the id is still an entry the reply wrote, so dropping it
      // would turn the refused citation into a different, unrelated shape complaint.
      issues.push({ code: 'unknown-fact', detail: unknownFactDetail(document, item.factId) })
    }
    if (items.some((existing) => existing.factId === item.factId)) return failShape('items.factId')
    items.push({ factId: item.factId, why: item.why })
  }
  // A release without a consensus still needs a reason to be shown. "No consensus was published" is
  // a data gap, not an explanation of what the number means: the why has to read actual vs previous.
  for (const item of items) {
    if (!item.factId.startsWith('macro:')) continue
    const macro = document.news.macro.find((candidate) => `macro:${candidate.eventKey}` === item.factId)
    if (macro && macro.consensus === undefined && !macroWhyExplainsActualVsPrevious(macro, item.why)) {
      return fail('invalid-macro-why', item.factId)
    }
  }
  const hidden: Array<{ factId: string; reason: string }> = []
  for (const entry of raw.hidden) {
    if (!isExact(entry, ['factId', 'reason'])) return failShape('hidden[]')
    if (!isText(entry.factId) || !isText(entry.reason)) return failShape('hidden[].factId')
    if (entry.reason.length > 200) return fail('too-long')
    if (!newsIds.has(entry.factId) && !macroIds.has(entry.factId)) {
      issues.push({ code: 'unknown-fact', detail: unknownFactDetail(document, entry.factId) })
    }
    if (items.some((shown) => shown.factId === entry.factId) || hidden.some((existing) => existing.factId === entry.factId)) return failShape('hidden[].factId')
    hidden.push({ factId: entry.factId, reason: entry.reason })
  }
  // Only judge "every fact is shown or hidden" over a reply whose citations all exist: with a refused
  // fact in hand, the count is off by construction and would hide the real reason behind a shape
  // complaint.
  if (issues.length === 0 && items.length + hidden.length !== newsIds.size + macroIds.size) return failShape('items')
  const webEvidence: DailyBriefWebEvidenceRef[] = []
  if (toolInvocations.filter((invocation) => invocation.toolName === 'WebSearch').length > dailyBriefWebSearchBudget.maximumSearches) return failShape('toolInvocations')
  if (raw.webEvidence !== undefined) {
    if (!Array.isArray(raw.webEvidence)) return failShape('webEvidence')
    const budget = createWebSearchBudget()
    const results = collectToolResults(toolInvocations)
    for (const entry of raw.webEvidence) {
      if (!isExact(entry, ['eventKey', 'field', 'value', 'sourceName', 'sourceUrl', 'publishedAt'], [])) return failShape('webEvidence[]')
      if (!isText(entry.eventKey) || !isText(entry.field) || !isText(entry.value) || !isText(entry.sourceName) || !isText(entry.sourceUrl) || !isText(entry.publishedAt)) return failShape('webEvidence[]')
      const macro = document.news.macro.find((item) => item.eventKey === entry.eventKey)
      if (!macroIds.has(`macro:${entry.eventKey}`)) return fail('unknown-fact', unknownFactDetail(document, `macro:${entry.eventKey}`))
      if (entry.field === 'actual' && macro?.actual) return failShape('webEvidence[].field')
      if (!['actual', 'consensus', 'previous', 'reaction'].includes(entry.field)) return failShape('webEvidence[].field')
      const result = results.get(entry.sourceUrl)
      if (!result || (result.publishedAt !== undefined && result.publishedAt !== entry.publishedAt)) return failShape('webEvidence[].reference')
      // The same event/field lookup is cached; a fourth event or seventh lookup is refused before
      // it can enter the citation list.
      if (budget.request(entry.eventKey, entry.field as DailyBriefWebEvidenceField) === 'denied') return failShape('webEvidence[].field')
      const ref: DailyBriefWebEvidenceRef = Object.freeze({
        evidenceRefId: `web:${entry.eventKey}:${entry.field}:${webEvidence.length + 1}`,
        eventKey: entry.eventKey, field: entry.field as DailyBriefWebEvidenceField, value: entry.value,
        sourceName: entry.sourceName, sourceUrl: entry.sourceUrl, publishedAt: entry.publishedAt, retrievedAt: document.provenance.readAt
      })
      if (checkDailyBriefWebEvidence(ref, document.edition.windowEnd) !== 'ok') return failShape('webEvidence[].reference')
      const existingIndex = webEvidence.findIndex((existing) => existing.eventKey === ref.eventKey && existing.field === ref.field)
      if (existingIndex < 0) {
        webEvidence.push(ref)
        continue
      }
      const existing = webEvidence[existingIndex]!
      if (existing.value === ref.value && existing.sourceUrl === ref.sourceUrl) return failShape('webEvidence[]')
      const existingOfficial = isOfficialWebSource(existing.sourceUrl)
      const refOfficial = isOfficialWebSource(ref.sourceUrl)
      if (refOfficial && !existingOfficial) webEvidence[existingIndex] = Object.freeze({ ...ref, sourceConflict: true })
      else if (existingOfficial && !refOfficial) webEvidence[existingIndex] = Object.freeze({ ...existing, sourceConflict: true })
      else webEvidence.push(Object.freeze({ ...ref, sourceConflict: true }))
    }
    webEvidence.sort((left, right) => Number(isOfficialWebSource(right.sourceUrl)) - Number(isOfficialWebSource(left.sourceUrl)))
  }
  const importance: Array<{ factId: string; tier: 'must' | 'support' | 'reference'; reasonText?: string }> = []
  for (const entry of raw.importance) {
    if (!isExact(entry, ['factId', 'tier'], ['reasonText'])) return failShape('importance[]')
    if (!isText(entry.factId) || !isText(entry.tier)) return failShape('importance[]')
    if (!dataIds.has(entry.factId)) return fail('unknown-fact', unknownFactDetail(document, entry.factId))
    if (entry.tier !== 'must' && entry.tier !== 'support' && entry.tier !== 'reference') return failShape('importance[].tier')
    if (entry.reasonText !== undefined && (!isText(entry.reasonText) || entry.reasonText.length > 200)) return fail('too-long')
    if (importance.some((existing) => existing.factId === entry.factId)) return failShape('importance[].factId')
    importance.push({ factId: entry.factId, tier: entry.tier, ...(entry.reasonText ? { reasonText: entry.reasonText } : {}) })
  }
  const hiddenData: Array<{ factId: string; reason: string }> = []
  for (const entry of (raw.hiddenData ?? []) as unknown[]) {
    if (!isExact(entry, ['factId', 'reason'])) return failShape('hidden[]')
    if (!isText(entry.factId) || !isText(entry.reason)) return failShape('hiddenData[]')
    if (entry.reason.length > 200) return fail('too-long')
    if (!dataIds.has(entry.factId)) return fail('unknown-fact', unknownFactDetail(document, entry.factId))
    if (importance.some((shown) => shown.factId === entry.factId) || hiddenData.some((existing) => existing.factId === entry.factId)) return failShape('hiddenData[].factId')
    hiddenData.push({ factId: entry.factId, reason: entry.reason })
  }
  // A material data fact may be hidden, but not silently: the editorial must say why. Immaterial
  // rows are already hidden by the rule layer with their own reason, so they need no entry here.
  const shownData = new Set([
    ...importance.map((entry) => entry.factId),
    ...documentVisibleDataFacts(document)
  ])
  const hiddenDataSet = new Set(hiddenData.map((entry) => entry.factId))
  for (const factId of materialDataFactIds(document)) {
    if (!shownData.has(factId) && !hiddenDataSet.has(factId)) return fail('missing-hidden-reason', factId)
  }
  const dataNote = optionalText(raw.dataNote, 240)
  if (dataNote === false) return fail('too-long')
  const invalidationNote = optionalText(raw.invalidationNote, 240)
  if (invalidationNote === false) return fail('too-long')
  // With no prior conclusion there is nothing to synthesize: the fact-layer conclusion stands and
  // is marked `fallback`, so the field is ignored rather than accepted as an aggregation. With at
  // least one prior, a synthesis is required — a copy of that prior is exactly what must not ship.
  let conclusionSynthesis: BriefingConclusionSynthesis | undefined
  if (priorConclusions.length > 0) {
    const synthesized = validateConclusionSynthesis(raw.conclusionSynthesis, document, priorConclusions)
    if (!synthesized.ok) issues.push({ code: synthesized.failureCode, ...(synthesized.detail ? { detail: synthesized.detail } : {}) })
    else conclusionSynthesis = synthesized.value
  }
  // A synthesized summary is already written in LOCALE, so a translation of the old fallback summary
  // would be attached to the wrong text. The field belongs to the no-synthesis (fallback) path only.
  let conclusionTranslation = optionalText(raw.conclusionTranslation, 2_000)
  if (conclusionTranslation === false) return fail('too-long')
  if (conclusionSynthesis) conclusionTranslation = undefined
  if (conclusionTranslation !== undefined && (!document.conclusion || !needsTranslation(document.conclusion.summary, locale))) return fail('invalid-translation')

  const nextFocus = validatedNextFocus(raw.nextFocus, document)
  const prose = editorialProse({
    lede: raw.lede, items, importance, nextFocus, dataNote, invalidationNote, conclusionTranslation, conclusionSynthesis
  })
  const hiddenTitles = [
    ...document.news.items.filter((item) => hidden.some((entry) => entry.factId === `news:${item.itemId}`)).map((item) => item.translatedTitle ?? item.title),
    ...document.news.macro.filter((item) => hidden.some((entry) => entry.factId === `macro:${item.eventKey}`)).map((item) => item.title)
  ].filter((title) => title.trim().length >= 8)
  const proseLower = prose.toLowerCase()
  if (hiddenTitles.some((title) => proseLower.includes(title.trim().toLowerCase()))) return failShape('prose')
  const forbidden = forbiddenContent(prose)
  if (forbidden) issues.push({ code: 'forbidden-content', detail: forbidden })
  // Times are facts from calendar timestamps but are written as HH:mm, not as a bare number; do
  // not let a legitimate "20:30" fail the numeric whitelist. Counts of the shown candidate set are
  // also safe and are not stored as string tokens in the document.
  const numericProse = prose.replace(/\b\d{1,2}:\d{2}\b/g, ' ')
  const unknown = findUnknownNumber(numericProse, buildNumericFactWhitelist(document))
  if (unknown) issues.push({ code: 'unknown-number', detail: unknown })
  // Every defect found above travels together: the first is the verdict, the rest are what the
  // repair round has to fix in one pass.
  if (issues.length > 0) return failAll(issues)
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      lede: raw.lede,
      items: Object.freeze(items.map((item) => Object.freeze(item))),
      hidden: Object.freeze(hidden.map((entry) => Object.freeze(entry))),
      ...(webEvidence.length > 0 ? { webEvidence: Object.freeze(webEvidence.map((entry) => Object.freeze(entry))) } : {}),
      importance: Object.freeze(importance.map((entry) => Object.freeze(entry))),
      hiddenData: Object.freeze(hiddenData.map((entry) => Object.freeze(entry))),
      ...(typeof dataNote === 'string' ? { dataNote } : {}),
      ...(typeof invalidationNote === 'string' ? { invalidationNote } : {}),
      ...(typeof conclusionTranslation === 'string' ? { conclusionTranslation } : {}),
      ...(conclusionSynthesis ? { conclusionSynthesis } : {}),
      ...(nextFocus ? { nextFocus } : {})
    })
  })
}

export function applyDailyBriefingEditorial(
  document: DailyBriefingDocument,
  editorial: DailyBriefingEditorialOutput,
  meta: DailyBriefingEditorialMeta,
  priorConclusions: readonly BriefingPriorConclusion[] = []
): DailyBriefingDocument {
  const newsWhy = new Map(editorial.items.filter((item) => item.factId.startsWith('news:')).map((item) => [item.factId.slice('news:'.length), item.why]))
  const macroWhy = new Map(editorial.items.filter((item) => item.factId.startsWith('macro:')).map((item) => [item.factId.slice('macro:'.length), item.why]))
  const importance = new Map(editorial.importance.map((entry) => [entry.factId.slice('data:'.length), entry]))
  const hiddenReason = new Map(editorial.hidden.map((entry) => [entry.factId, entry.reason]))
  const selected = selectBriefingDataFacts(document, {
    include: editorial.importance.map((entry) => entry.factId),
    hidden: editorial.hiddenData
  })
  const citations = [...document.citations, ...(editorial.webEvidence ?? []).map((ref) => Object.freeze({
    index: document.citations.length + (editorial.webEvidence ?? []).indexOf(ref) + 1,
    refId: ref.evidenceRefId,
    sourceLabel: ref.sourceName,
    observedAt: ref.publishedAt,
    statement: `${ref.eventKey} ${ref.field}: ${ref.value}${ref.sourceConflict ? ' (source conflict)' : ''}`
  }))]
  const applyRow = <T extends BriefingMarketRow | BriefingPulseRow>(row: T): T => {
    const next = importance.get(row.id)
    if (!next) return row
    // The floor is a floor: the model may lift a support row, never downgrade a must row.
    if (row.importance.tier === 'must' && next.tier !== 'must') return row
    const value: FactImportance = Object.freeze({
      tier: next.tier,
      source: 'agent' as const,
      reasonCode: 'agent' as const,
      ...(next.reasonText ? { reasonText: next.reasonText } : {})
    })
    return Object.freeze({ ...row, importance: value }) as T
  }
  const data = Object.freeze({
    ...selected.data,
    market: Object.freeze(selected.data.market.map(applyRow)),
    funds: Object.freeze(selected.data.funds.map(applyRow)),
    sentiment: Object.freeze({
      fearGreed: selected.data.sentiment.fearGreed ? applyRow(selected.data.sentiment.fearGreed) : null,
      news: selected.data.sentiment.news
    })
  })
  const nextItems = editorial.nextFocus
    ? document.next.items.map((item) => item.eventKey === editorial.nextFocus!.eventKey
      ? Object.freeze({ ...item, why: editorial.nextFocus!.why, watch: editorial.nextFocus!.watch })
      : item)
    : document.next.items
  const focus = editorial.nextFocus
    ? document.next.focus && document.next.focus.eventKey === editorial.nextFocus.eventKey
      ? Object.freeze({ ...document.next.focus, why: editorial.nextFocus.why, watch: editorial.nextFocus.watch })
      : document.next.focus
    : document.next.focus
  return Object.freeze({
    ...document,
    ...(editorial.nextFocus ? { next: Object.freeze({ ...document.next, items: Object.freeze(nextItems), ...(focus ? { focus } : {}) }) } : {}),
    lede: Object.freeze({
      source: 'agent' as const,
      text: editorial.lede,
      ...(isLedePattern(editorial.ledePattern) ? { pattern: editorial.ledePattern } : {}),
      ...(document.lede.previousPattern ? { previousPattern: document.lede.previousPattern } : {}),
      factCount: editorial.items.length + document.news.macro.length,
      generatedAt: document.edition.generatedAt
    }),
    news: Object.freeze({
      ...document.news,
      items: Object.freeze(document.news.items.map((item: BriefingNewsItem) => newsWhy.has(item.itemId)
        ? Object.freeze({ ...item, why: newsWhy.get(item.itemId)!, visibility: 'shown' as const })
        : Object.freeze({ ...item, visibility: 'hidden' as const, ...(hiddenReason.get(`news:${item.itemId}`) ? { visibilityReason: hiddenReason.get(`news:${item.itemId}`)! } : {}) }))),
      macro: Object.freeze(document.news.macro.map((item: BriefingMacroItem) => {
        // Visibility is the editor's decision. The system never injects a shown release without a
        // why, so a macro the editorial did not explain stays hidden with its reason.
        if (macroWhy.has(item.eventKey)) return Object.freeze({ ...item, why: macroWhy.get(item.eventKey)!, visibility: 'shown' as const })
        // 没有实际值、或已取消的事件不参加选材（`A0.12` ⑤ / v2.125），模型也就没有 why 可写；
        // 但它们在版面上必须出现：值缺席时那一格整块不渲染，取消的那一行带「已取消」标记。
        if (item.actual === undefined || item.lifecycleState === 'cancelled') return Object.freeze({ ...item, visibility: 'shown' as const })
        return Object.freeze({ ...item, visibility: 'hidden' as const, ...(hiddenReason.get(`macro:${item.eventKey}`) ? { visibilityReason: hiddenReason.get(`macro:${item.eventKey}`)! } : {}) })
      }))
    }),
    data,
    ...(editorial.dataNote || editorial.invalidationNote ? {
      editorial: Object.freeze({
        ...(editorial.dataNote ? { dataNote: editorial.dataNote } : {}),
        ...(editorial.invalidationNote ? { invalidationNote: editorial.invalidationNote } : {})
      })
    } : {}),
    ...(editorial.conclusionSynthesis && document.conclusion && priorConclusions.length > 0 ? {
      conclusion: Object.freeze({
        ...document.conclusion,
        direction: editorial.conclusionSynthesis.direction,
        summary: editorial.conclusionSynthesis.summary,
        // The published basis must belong to this forecast. The earlier analysis conclusion's
        // conditions, invalidations and counter evidence are for a different call and a different
        // horizon, so they are replaced by the synthesis's own premises and falsifiers — or, when a
        // legacy recap carries no forward view, dropped instead of rendered as if they still held.
        ...briefingConclusionBasis(editorial.conclusionSynthesis),
        synthesis: 'agent' as const,
        synthesizedFrom: Object.freeze(priorConclusions.map((conclusion) => conclusion.id)),
        synthesisDetail: Object.freeze({
          ...editorial.conclusionSynthesis,
          conditions: Object.freeze([...editorial.conclusionSynthesis.conditions]),
          counterEvidence: Object.freeze([...editorial.conclusionSynthesis.counterEvidence]),
          watch: Object.freeze([...editorial.conclusionSynthesis.watch]),
          confirmed: Object.freeze([...editorial.conclusionSynthesis.confirmed]),
          refuted: Object.freeze([...editorial.conclusionSynthesis.refuted]),
          evidenceRefs: Object.freeze([...editorial.conclusionSynthesis.evidenceRefs])
        })
      })
    } : editorial.conclusionTranslation && document.conclusion ? {
      conclusion: Object.freeze({ ...document.conclusion, translation: editorial.conclusionTranslation })
    } : {}),
    citations: Object.freeze(citations),
    provenance: Object.freeze({
      ...document.provenance,
      selectionAudit: mergeSelectionAudit(document.provenance.selectionAudit, withEditorialReasons(briefingDataVisibilityAudit({ ...document, data }), editorial.hiddenData)),
      editorialMeta: Object.freeze({
        promptVersion: meta.promptVersion,
        model: meta.model,
        source: meta.source
      })
    })
  })
}

function documentVisibleDataFacts(document: DailyBriefingDocument): readonly string[] {
  return briefingDataVisibilityAudit(document).shown
}

/** Material data facts a silent omission would drop: the agent must include them or say why not. */
function materialDataFactIds(document: DailyBriefingDocument): readonly string[] {
  const rows: Array<BriefingMarketRow | BriefingPulseRow> = [
    ...document.data.market,
    ...document.data.funds,
    ...(document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : [])
  ]
  const ids: string[] = []
  for (const row of rows) {
    if (row.importance.tier === 'must') continue
    if (row.materiality?.material && row.materiality.reasonCode !== 'gap') ids.push(`data:${row.id}`)
  }
  if (document.data.leverage?.materiality?.material && document.data.leverage.materiality.reasonCode !== 'gap') ids.push('data:leverage')
  if (document.data.policyPath?.materiality?.material) ids.push('data:policy-path')
  return ids
}

function mergeSelectionAudit(
  prior: Readonly<{ shown: readonly string[]; hidden: readonly Readonly<{ factId: string; reason: string }>[] }> | undefined,
  dataAudit: Readonly<{ shown: readonly string[]; hidden: readonly Readonly<{ factId: string; reason: string }>[] }>
): Readonly<{ shown: readonly string[]; hidden: readonly Readonly<{ factId: string; reason: string }>[] }> {
  const isData = (factId: string) => factId.startsWith('data:')
  return Object.freeze({
    shown: Object.freeze([...(prior?.shown ?? []).filter((factId) => !isData(factId)), ...dataAudit.shown]),
    hidden: Object.freeze([...(prior?.hidden ?? []).filter((entry) => !isData(entry.factId)), ...dataAudit.hidden])
  })
}

/**
 * A shape failure always names the field it was reading.
 *
 * "The AI output is malformed" is true of every shape failure and useful for none of them: the reader
 * cannot act on it and the repair prompt cannot aim at it. The field path is the whole message.
 */
function failShape(field: string): DailyBriefingValidation {
  return fail('invalid-shape', field)
}

function fail(failureCode: DailyBriefingValidationFailure, detail?: string): DailyBriefingValidation {
  return Object.freeze({ ok: false as const, failureCode, ...(detail ? { detail } : {}) })
}


/**
 * A release without consensus has no surprise to explain, so it is explained by the number itself:
 * the why must quote the actual and the previous print. Missing consensus may be noted as a data
 * gap, but it cannot be the reason the release does not matter.
 */
function macroWhyExplainsActualVsPrevious(macro: BriefingMacroItem, why: string): boolean {
  const text = why.toLowerCase()
  const actual = macro.actual?.trim().toLowerCase()
  if (!actual || !text.includes(actual)) return false
  const previous = macro.previous?.trim().toLowerCase()
  if (previous && !text.includes(previous)) return false
  const dismisses = /(?:无预期|没有预期|未公布预期|no consensus|consensus (?:is |was )?(?:missing|unavailable|not published))[^。.!?]{0,40}(?:不重要|无关|不可交易|not important|not actionable|irrelevant|nothing to trade|does not matter)/i
  return !dismisses.test(why)
}

function optionalText(value: unknown, maximum: number): string | undefined | false {
  if (value === undefined) return undefined
  if (!isText(value) || value.length > maximum) return false
  return value
}

function needsTranslation(summary: string, locale: 'zh-CN' | 'en-US'): boolean {
  const hasCjk = /[\u3400-\u9fff]/.test(summary)
  return locale === 'zh-CN' ? !hasCjk : hasCjk
}

function forbiddenContent(text: string): string | undefined {
  return /https?:\/\/\S*|www\.\S*|```|<script|建议\s*(?:买入|卖出|做多|做空)|目标价|必涨|必跌|price target|buy now|sell now|go long|go short/i.exec(text)?.[0]
}

function isExact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

import { collectToolResults, isLedePattern } from './dailyBriefingValidationGuards'
export { hasBriefingNextTransmission } from './dailyBriefingValidationGuards'
// 报错点名是哪个 id、它到底在哪（Chief 2026-11-06）：只说 unknown-fact，模型只能猜，猜错再烧一轮。
function unknownFactDetail(document: DailyBriefingDocument, factId: string): string {
  const hidden = document.provenance.selectionAudit?.hidden ?? []
  return hidden.some((entry) => entry.factId === factId) ? `${factId} was hidden by selection, so it is not a fact in this edition; do not show or cite it` : `${factId} is not a fact in this edition`
}
