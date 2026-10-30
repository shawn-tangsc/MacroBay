import type {
  BriefingMacroItem,
  BriefingNewsItem,
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
import { selectMacroFloorItem } from './dailyBriefingDocument'

export type DailyBriefingEditorialOutput = Readonly<{
  lede: string
  ledePattern?: string
  items: readonly Readonly<{ factId: string; why: string }>[]
  hidden: readonly Readonly<{ factId: string; reason: string }>[]
  webEvidence?: readonly DailyBriefWebEvidenceRef[]
  importance: readonly Readonly<{ factId: string; tier: 'must' | 'support' | 'reference'; reasonText?: string }>[]
  dataNote?: string
  invalidationNote?: string
  conclusionTranslation?: string
  nextFocus?: Readonly<{
    eventKey: string
    why: string
    watch: readonly Readonly<{ condition: string; implication: string }>[]
  }>
}>

export type DailyBriefingValidationFailure =
  | 'invalid-shape'
  | 'unknown-fact'
  | 'forbidden-content'
  | 'unknown-number'
  | 'invalid-translation'
  | 'too-long'

export type DailyBriefingValidation =
  | Readonly<{ ok: true; value: DailyBriefingEditorialOutput }>
  | Readonly<{ ok: false; failureCode: DailyBriefingValidationFailure; detail?: string }>

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
  toolInvocations: readonly AgentRuntimeToolInvocation[] = []
): DailyBriefingValidation {
  if (!isExact(raw, ['lede', 'ledePattern', 'items', 'hidden', 'importance'], ['dataNote', 'invalidationNote', 'conclusionTranslation', 'nextFocus', 'webEvidence'])) {
    return fail('invalid-shape')
  }
  if (typeof raw.lede !== 'string' || raw.lede.trim().length === 0) return fail('invalid-shape')
  if (!isLedePattern(raw.ledePattern)) return fail('invalid-shape')
  if (document.lede.previousPattern && document.lede.previousPattern === raw.ledePattern) return fail('invalid-shape')
  if (raw.lede.length > 600) return fail('too-long')
  if (!Array.isArray(raw.items) || raw.items.length > 50) return fail('invalid-shape')
  if (!Array.isArray(raw.hidden)) return fail('invalid-shape')
  if (!Array.isArray(raw.importance)) return fail('invalid-shape')
  const newsIds = new Set(document.news.items.map((item) => `news:${item.itemId}`))
  const macroIds = new Set(document.news.macro.map((item) => `macro:${item.eventKey}`))
  const dataIds = new Set(allDataRows(document).map((row) => `data:${row.id}`))
  const items: Array<{ factId: string; why: string }> = []
  for (const item of raw.items) {
    if (!isExact(item, ['factId', 'why'])) return fail('invalid-shape')
    if (!isText(item.factId) || !isText(item.why)) return fail('invalid-shape')
    if (item.why.length > 200) return fail('too-long')
    if (!newsIds.has(item.factId) && !macroIds.has(item.factId)) return fail('unknown-fact')
    if (items.some((existing) => existing.factId === item.factId)) return fail('invalid-shape')
    items.push({ factId: item.factId, why: item.why })
  }
  const hidden: Array<{ factId: string; reason: string }> = []
  for (const entry of raw.hidden) {
    if (!isExact(entry, ['factId', 'reason'])) return fail('invalid-shape')
    if (!isText(entry.factId) || !isText(entry.reason)) return fail('invalid-shape')
    if (entry.reason.length > 200) return fail('too-long')
    if (!newsIds.has(entry.factId) && !macroIds.has(entry.factId)) return fail('unknown-fact')
    if (items.some((shown) => shown.factId === entry.factId) || hidden.some((existing) => existing.factId === entry.factId)) return fail('invalid-shape')
    hidden.push({ factId: entry.factId, reason: entry.reason })
  }
  if (items.length + hidden.length !== newsIds.size + macroIds.size) return fail('invalid-shape')
  const webEvidence: DailyBriefWebEvidenceRef[] = []
  if (toolInvocations.filter((invocation) => invocation.toolName === 'WebSearch').length > dailyBriefWebSearchBudget.maximumSearches) return fail('invalid-shape')
  if (raw.webEvidence !== undefined) {
    if (!Array.isArray(raw.webEvidence)) return fail('invalid-shape')
    const budget = createWebSearchBudget()
    const results = collectToolResults(toolInvocations)
    for (const entry of raw.webEvidence) {
      if (!isExact(entry, ['eventKey', 'field', 'value', 'sourceName', 'sourceUrl', 'publishedAt'], [])) return fail('invalid-shape')
      if (!isText(entry.eventKey) || !isText(entry.field) || !isText(entry.value) || !isText(entry.sourceName) || !isText(entry.sourceUrl) || !isText(entry.publishedAt)) return fail('invalid-shape')
      const macro = document.news.macro.find((item) => item.eventKey === entry.eventKey)
      if (!macroIds.has(`macro:${entry.eventKey}`)) return fail('unknown-fact')
      if (entry.field === 'actual' && macro?.actual) return fail('invalid-shape')
      if (!['actual', 'consensus', 'previous', 'reaction'].includes(entry.field)) return fail('invalid-shape')
      const result = results.get(entry.sourceUrl)
      if (!result || (result.publishedAt !== undefined && result.publishedAt !== entry.publishedAt)) return fail('invalid-shape')
      // The same event/field lookup is cached; a fourth event or seventh lookup is refused before
      // it can enter the citation list.
      if (budget.request(entry.eventKey, entry.field as DailyBriefWebEvidenceField) === 'denied') return fail('invalid-shape')
      const ref: DailyBriefWebEvidenceRef = Object.freeze({
        evidenceRefId: `web:${entry.eventKey}:${entry.field}:${webEvidence.length + 1}`,
        eventKey: entry.eventKey, field: entry.field as DailyBriefWebEvidenceField, value: entry.value,
        sourceName: entry.sourceName, sourceUrl: entry.sourceUrl, publishedAt: entry.publishedAt, retrievedAt: document.provenance.readAt
      })
      if (checkDailyBriefWebEvidence(ref, document.edition.windowEnd) !== 'ok') return fail('invalid-shape')
      const existingIndex = webEvidence.findIndex((existing) => existing.eventKey === ref.eventKey && existing.field === ref.field)
      if (existingIndex < 0) {
        webEvidence.push(ref)
        continue
      }
      const existing = webEvidence[existingIndex]!
      if (existing.value === ref.value && existing.sourceUrl === ref.sourceUrl) return fail('invalid-shape')
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
    if (!isExact(entry, ['factId', 'tier'], ['reasonText'])) return fail('invalid-shape')
    if (!isText(entry.factId) || !isText(entry.tier)) return fail('invalid-shape')
    if (!dataIds.has(entry.factId)) return fail('unknown-fact')
    if (entry.tier !== 'must' && entry.tier !== 'support' && entry.tier !== 'reference') return fail('invalid-shape')
    if (entry.reasonText !== undefined && (!isText(entry.reasonText) || entry.reasonText.length > 200)) return fail('too-long')
    if (importance.some((existing) => existing.factId === entry.factId)) return fail('invalid-shape')
    importance.push({ factId: entry.factId, tier: entry.tier, ...(entry.reasonText ? { reasonText: entry.reasonText } : {}) })
  }
  const dataNote = optionalText(raw.dataNote, 240)
  if (dataNote === false) return fail('too-long')
  const invalidationNote = optionalText(raw.invalidationNote, 240)
  if (invalidationNote === false) return fail('too-long')
  const conclusionTranslation = optionalText(raw.conclusionTranslation, 2_000)
  if (conclusionTranslation === false) return fail('too-long')
  if (conclusionTranslation !== undefined && (!document.conclusion || !needsTranslation(document.conclusion.summary, locale))) return fail('invalid-translation')

  let nextFocus: DailyBriefingEditorialOutput['nextFocus']
  if (raw.nextFocus !== undefined && isExact(raw.nextFocus, ['eventKey', 'why', 'watch'])) {
    const focusKey = document.next.focus?.eventKey
    const watchRaw = raw.nextFocus.watch
    const watchCount = Array.isArray(watchRaw) ? watchRaw.length : 0
    const watch = Array.isArray(watchRaw) && watchCount >= 2 && watchCount <= 3
      ? watchRaw.filter((entry): entry is { condition: string; implication: string } => isExact(entry, ['condition', 'implication']) && isText(entry.condition) && isText(entry.implication))
      : []
    if (focusKey && raw.nextFocus.eventKey === focusKey && isText(raw.nextFocus.why) && raw.nextFocus.why.length <= 200 &&
      watch.length === watchCount && watch.every((entry) => entry.condition.length <= 80 && entry.implication.length <= 160)) {
      nextFocus = Object.freeze({ eventKey: raw.nextFocus.eventKey, why: raw.nextFocus.why, watch: Object.freeze(watch.map((entry) => Object.freeze(entry))) })
    }
  }
  const prose = [raw.lede, ...items.map((item) => item.why), ...importance.map((entry) => entry.reasonText ?? ''),
    ...(nextFocus ? [nextFocus.why, ...nextFocus.watch.flatMap((entry) => [entry.condition, entry.implication])] : []),
    ...(typeof dataNote === 'string' ? [dataNote] : []), ...(typeof invalidationNote === 'string' ? [invalidationNote] : []),
    ...(typeof conclusionTranslation === 'string' ? [conclusionTranslation] : [])].join('\n')
  const hiddenTitles = [
    ...document.news.items.filter((item) => hidden.some((entry) => entry.factId === `news:${item.itemId}`)).map((item) => item.translatedTitle ?? item.title),
    ...document.news.macro.filter((item) => hidden.some((entry) => entry.factId === `macro:${item.eventKey}`)).map((item) => item.title)
  ].filter((title) => title.trim().length >= 8)
  const proseLower = prose.toLowerCase()
  if (hiddenTitles.some((title) => proseLower.includes(title.trim().toLowerCase()))) return fail('invalid-shape')
  const forbidden = forbiddenContent(prose)
  if (forbidden) return fail('forbidden-content', forbidden)
  // Times are facts from calendar timestamps but are written as HH:mm, not as a bare number; do
  // not let a legitimate "20:30" fail the numeric whitelist. Counts of the shown candidate set are
  // also safe and are not stored as string tokens in the document.
  const numericProse = prose.replace(/\b\d{1,2}:\d{2}\b/g, ' ')
  const unknown = unknownNumber(numericProse, document)
  if (unknown) return fail('unknown-number', unknown)
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      lede: raw.lede,
      items: Object.freeze(items.map((item) => Object.freeze(item))),
      hidden: Object.freeze(hidden.map((entry) => Object.freeze(entry))),
      ...(webEvidence.length > 0 ? { webEvidence: Object.freeze(webEvidence.map((entry) => Object.freeze(entry))) } : {}),
      importance: Object.freeze(importance.map((entry) => Object.freeze(entry))),
      ...(typeof dataNote === 'string' ? { dataNote } : {}),
      ...(typeof invalidationNote === 'string' ? { invalidationNote } : {}),
      ...(typeof conclusionTranslation === 'string' ? { conclusionTranslation } : {}),
      ...(nextFocus ? { nextFocus } : {})
    })
  })
}

export function applyDailyBriefingEditorial(
  document: DailyBriefingDocument,
  editorial: DailyBriefingEditorialOutput,
  meta: DailyBriefingEditorialMeta
): DailyBriefingDocument {
  const newsWhy = new Map(editorial.items.filter((item) => item.factId.startsWith('news:')).map((item) => [item.factId.slice('news:'.length), item.why]))
  const macroWhy = new Map(editorial.items.filter((item) => item.factId.startsWith('macro:')).map((item) => [item.factId.slice('macro:'.length), item.why]))
  const importance = new Map(editorial.importance.map((entry) => [entry.factId.slice('data:'.length), entry]))
  const hiddenReason = new Map(editorial.hidden.map((entry) => [entry.factId, entry.reason]))
  const macroFloor = selectMacroFloorItem(document.news.macro)
  const highImpactShown = document.news.macro.some((item) => item.importance === 'high' && macroWhy.has(item.eventKey))
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
        if (macroWhy.has(item.eventKey)) return Object.freeze({ ...item, why: macroWhy.get(item.eventKey)!, visibility: 'shown' as const })
        // The floor is a floor: if the editorial would hide every high-impact release, the key
        // release stays visible even though the model listed it in `hidden` with a reason.
        if (!highImpactShown && macroFloor?.eventKey === item.eventKey) return Object.freeze({ ...item, visibility: 'shown' as const })
        return Object.freeze({ ...item, visibility: 'hidden' as const, ...(hiddenReason.get(`macro:${item.eventKey}`) ? { visibilityReason: hiddenReason.get(`macro:${item.eventKey}`)! } : {}) })
      }))
    }),
    data: Object.freeze({
      ...document.data,
      market: Object.freeze(document.data.market.map(applyRow)),
      funds: Object.freeze(document.data.funds.map(applyRow)),
      sentiment: Object.freeze({
        fearGreed: document.data.sentiment.fearGreed ? applyRow(document.data.sentiment.fearGreed) : null,
        news: document.data.sentiment.news
      })
    }),
    ...(editorial.dataNote || editorial.invalidationNote ? {
      editorial: Object.freeze({
        ...(editorial.dataNote ? { dataNote: editorial.dataNote } : {}),
        ...(editorial.invalidationNote ? { invalidationNote: editorial.invalidationNote } : {})
      })
    } : {}),
    ...(editorial.conclusionTranslation && document.conclusion ? {
      conclusion: Object.freeze({ ...document.conclusion, translation: editorial.conclusionTranslation })
    } : {}),
    citations: Object.freeze(citations),
    provenance: Object.freeze({
      ...document.provenance,
      editorialMeta: Object.freeze({
        promptVersion: meta.promptVersion,
        model: meta.model,
        source: meta.source
      })
    })
  })
}

function allDataRows(document: DailyBriefingDocument): Array<BriefingMarketRow | BriefingPulseRow> {
  return [...document.data.market, ...document.data.funds, ...(document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : [])]
}

function fail(failureCode: DailyBriefingValidationFailure, detail?: string): DailyBriefingValidation {
  return Object.freeze({ ok: false as const, failureCode, ...(detail ? { detail } : {}) })
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

function unknownNumber(text: string, document: DailyBriefingDocument): string | undefined {
  const allowed = numericWhitelist(document)
  for (const token of text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const normalized = token.replace(/,/g, '')
    if (allowed.has(normalized) || allowed.has(normalized.replace(/^-/, ''))) continue
    return token
  }
  return undefined
}

function numericWhitelist(document: DailyBriefingDocument): Set<string> {
  const values = new Set<string>()
  const add = (value: number): void => {
    for (let digits = 0; digits <= 4; digits += 1) {
      values.add(value.toFixed(digits))
      values.add(Math.abs(value).toFixed(digits))
    }
  }
  const visit = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) add(value)
    else if (typeof value === 'string') {
      for (const token of value.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []) add(Number(token.replace(/,/g, '')))
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(document)
  // Safe counts/time anchors that the prose may legitimately name.
  add(24)
  add(document.news.items.length)
  add(document.news.macro.length)
  add(document.citations.length)
  return values
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

export function isLedePattern(value: unknown): value is import('../../../contracts/dailyBriefing').DailyBriefLedePattern {
  return value === 'event-shock' || value === 'surprise-gap' || value === 'tension' || value === 'structure' || value === 'setup' || value === 'outlier' || value === 'falsification'
}

function collectToolResults(invocations: readonly AgentRuntimeToolInvocation[]): Map<string, { title: string; publishedAt?: string }> {
  const results = new Map<string, { title: string; publishedAt?: string }>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!value || typeof value !== 'object') return
    const row = value as { title?: unknown; url?: unknown; publishedAt?: unknown; content?: unknown; results?: unknown }
    if (typeof row.url === 'string') {
      results.set(row.url, { title: typeof row.title === 'string' ? row.title : row.url, ...(typeof row.publishedAt === 'string' ? { publishedAt: row.publishedAt } : {}) })
    }
    if (row.content !== undefined) walk(row.content)
    if (row.results !== undefined) walk(row.results)
  }
  for (const invocation of invocations) walk(invocation.output)
  return results
}
