import type { DailyBriefingDocument, DailyBriefingLocale, DailyBriefingReadingState } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingPrompt, buildDailyBriefingSelectionPrompt } from './dailyBriefingPrompt'
import { applyDailyBriefingEditorial, validateDailyBriefingEditorial } from './dailyBriefingValidation'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { dailyBriefEditionKey, dailyBriefSessionCopy, dailyBriefSessionCopyText } from './dailyBriefEditorSessionNaming'
import { selectMacroFloorItem } from './dailyBriefingDocument'
import {
  dailyBriefBackfillPolicy,
  isCanonicalDailyBriefBackfillTime,
  isDailyBriefBackfillMetric,
  isDailyBriefBackfillResult,
  type DailyBriefBackfillRequest,
  type DailyBriefBackfillResult
} from '../public-query/dailyBriefBackfill'

export type DailyBriefAgentTurnResult =
  | Readonly<{ state: 'accepted'; document: DailyBriefingDocument; sessionId: string; toolInvocations: readonly import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] }>
  | Readonly<{ state: 'failed'; failureCode: string; failureDetail?: string; sessionId: string; toolInvocations: readonly import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] }>

/**
 * One gap the frozen edition can state but could not fill: a row that is missing, stale or disabled.
 *
 * The list is derived from the document itself, so the ids the editor may ask about are exactly the
 * ids the reader sees, and a source the reader turned off is listed but never requested.
 */
export type DailyBriefDataGap = Readonly<{
  id: string
  source: string
  metric: string
  asOf: string
  state: DailyBriefingReadingState
  reason: string
  requestable: boolean
}>

/** The product's historical backfill tool, already bound to the edition cutoff. */
export type DailyBriefBackfillExecutor = (request: DailyBriefBackfillRequest) => Promise<DailyBriefBackfillResult>

export type DailyBriefAgentTurnInput = Readonly<{
  runner: DailyBriefAgentRunner
  document: DailyBriefingDocument
  locale: DailyBriefingLocale
  allowedTools?: readonly string[]
  /**
   * Optional so the turn keeps working when no historian is wired: a requested backfill then answers
   * `backfill-unwired`, which is a gap, not a fabricated value or a failed edition.
   */
  backfill?: DailyBriefBackfillExecutor
}>

export async function runDailyBriefAgentTurn(input: DailyBriefAgentTurnInput): Promise<DailyBriefAgentTurnResult> {
  const editionKey = dailyBriefEditionKey(input.document.edition.date, input.locale)
  const copy = dailyBriefSessionCopy(input.locale)
  const summary = factSummary(input.document, input.locale)
  const gaps = collectDataGaps(input.document)
  const protocol = backfillProtocol(gaps, input.document)
  const selectionPrompt = [
    buildDailyBriefingSelectionPrompt({ document: input.document, locale: input.locale })
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n'),
    ...(protocol ? [protocol] : [])
  ].join('\n\n')
  const started = await input.runner.start({ editionKey, date: input.document.edition.date, locale: input.locale, prompt: selectionPrompt, displayText: `${summary.detail}\n\n${copy.firstTask}`, context: summary, ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}) })
  let selection: unknown
  try { selection = JSON.parse(started.assistantText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) } catch { selection = undefined }
  const toolInvocations: import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] = [...started.toolInvocations]
  let response: string
  if (!selection || typeof selection !== 'object' || (selection as { stage?: unknown }).stage !== 'select') {
    const corrected = await input.runner.continue(started.sessionId, 'Your selection JSON was invalid. Return {"stage":"select",...} and nothing else.')
    try { selection = JSON.parse(corrected.assistantText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) } catch { selection = undefined }
    toolInvocations.push(...corrected.toolInvocations)
  }
  if (!selection || typeof selection !== 'object' || (selection as { stage?: unknown }).stage !== 'select') {
    await input.runner.finish(started.sessionId, 'failed')
    return { state: 'failed', failureCode: 'invalid-shape', failureDetail: 'selection', sessionId: started.sessionId, toolInvocations }
  }
  const unknown = unknownSelection(selection, input.document)
  if (unknown) {
    await input.runner.finish(started.sessionId, 'failed')
    return { state: 'failed', failureCode: 'invalid-shape', failureDetail: `selection-unknown:${unknown}`, sessionId: started.sessionId, toolInvocations }
  }
  const requests = (selection as { requests?: unknown }).requests
  const backfill = await runBackfillRound(selection, input, gaps)
  if ((Array.isArray(requests) && requests.length > 0) || backfill) {
    const sections: string[] = []
    if (Array.isArray(requests) && requests.length > 0) sections.push(`FIELD RESPONSE:\n${fieldResponse(input.document, requests, input.locale)}`)
    if (backfill) sections.push(backfillMessage(backfill, input.document.edition.windowEnd))
    const answer = await input.runner.continue(started.sessionId, `${sections.join('\n\n')}\nReturn the next selection JSON if you need to adjust; otherwise continue.`)
    toolInvocations.push(...answer.toolInvocations)
    try {
      const adjusted = JSON.parse(answer.assistantText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
      if (adjusted && typeof adjusted === 'object' && (adjusted as { stage?: unknown }).stage === 'select') selection = adjusted
    } catch { /* keep the prior selection when the model just acknowledges */ }
  }
  const selectedDocument = selectDocument(input.document, selection)
  const prompt = buildDailyBriefingPrompt({ document: selectedDocument, locale: input.locale, selection })
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
  const written = await input.runner.continue(started.sessionId, prompt, `任务 2/2 · 写作\n\n${prompt}`)
  response = written.assistantText
  toolInvocations.push(...written.toolInvocations)
  let failureCode = 'invalid-json'
  let failureDetail: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    let parsed: unknown
    try { parsed = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) } catch { parsed = undefined }
    if (parsed) {
      const validation = validateDailyBriefingEditorial(parsed, selectedDocument, input.locale, toolInvocations)
      if (validation.ok) {
        const document = applyDailyBriefingEditorial(selectedDocument, validation.value, { promptVersion: 'daily-briefing.agent.v1', model: 'agent-session', source: 'default' })
        await input.runner.finish(started.sessionId, 'accepted')
        return { state: 'accepted', document, sessionId: started.sessionId, toolInvocations }
      }
      failureCode = validation.failureCode
      failureDetail = validation.detail
    }
    if (attempt < 2) {
      const repair = await input.runner.continue(started.sessionId, `Your previous JSON failed validation: ${failureCode}${failureDetail ? ` (${failureDetail})` : ''}. Rewrite the full JSON using only facts from the prompt.`)
      response = repair.assistantText
      toolInvocations.push(...repair.toolInvocations)
    }
  }
  await input.runner.finish(started.sessionId, 'failed')
  return { state: 'failed', failureCode, ...(failureDetail ? { failureDetail } : {}), sessionId: started.sessionId, toolInvocations }
}

const MARKET_GAP_METRICS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  dxy: Object.freeze(['dxy', 'dxy-level'] as const),
  gold: Object.freeze(['gold', 'gold-level-usd'] as const),
  us10y: Object.freeze(['treasury', 'us10y-yield-percent'] as const),
  'us10y-real': Object.freeze(['treasury', 'us10y-real-yield-percent'] as const)
})

const FUNDS_GAP_METRICS: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  stablecoin: Object.freeze(['stablecoin', 'core-stablecoin-supply-usd'] as const),
  'etf-btc': Object.freeze(['etf', 'etf-net-flow-btc'] as const),
  'etf-eth': Object.freeze(['etf', 'etf-net-flow-eth'] as const),
  'funding-btc': Object.freeze(['funding', 'funding-rate-percent-btc'] as const),
  'funding-eth': Object.freeze(['funding', 'funding-rate-percent-eth'] as const)
})

export function collectDataGaps(document: DailyBriefingDocument): readonly DailyBriefDataGap[] {
  const asOf = document.edition.windowEnd
  const gaps = new Map<string, DailyBriefDataGap>()
  const add = (source: string, metric: string, state: DailyBriefingReadingState, reason: string): void => {
    if (!isDailyBriefBackfillMetric(source, metric)) return
    const id = `${source}:${metric}`
    if (gaps.has(id)) return
    gaps.set(id, Object.freeze({ id, source, metric, asOf, state, reason, requestable: state !== 'source-disabled' }))
  }
  for (const row of document.data.market) {
    if (row.state === 'available') continue
    const pair = MARKET_GAP_METRICS[row.id]
    if (pair) add(pair[0], pair[1], row.state, row.reason ?? row.state)
  }
  for (const row of document.data.funds) {
    if (row.state === 'available') continue
    const pair = FUNDS_GAP_METRICS[row.id]
    if (pair) add(pair[0], pair[1], row.state, row.reason ?? row.state)
  }
  const leverage = document.data.leverage
  if (!leverage || leverage.state !== 'available') {
    const state: DailyBriefingReadingState = leverage?.state ?? 'unavailable'
    add('open-interest', 'open-interest-usd-btc', state, 'open-interest row missing')
    add('open-interest', 'open-interest-usd-eth', state, 'open-interest row missing')
  }
  return Object.freeze([...gaps.values()])
}

function backfillProtocol(gaps: readonly DailyBriefDataGap[], document: DailyBriefingDocument): string {
  if (gaps.length === 0) return ''
  return [
    `DATA GAPS (frozen at ${document.edition.windowEnd}):`,
    ...gaps.map((gap) => `- ${gap.id} asOf=${gap.asOf} state=${gap.state} reason=${gap.reason} ${gap.requestable ? 'requestable' : 'not-requestable'}`),
    `BACKFILL: you may ask the product to re-read a requestable gap at its as-of instant. Add a "backfill" array to the same select JSON: {"source":"<source>","metric":"<metric>","asOf":"<the gap asOf or earlier>"}. At most ${dailyBriefBackfillPolicy.maximumRequestsPerRound}, one round per edition.`,
    'The tool answers with a value plus observedAt/sourceUrl/method, or a named GAP. Never estimate a GAP, never change an official actual, and only ask about ids listed above.'
  ].join('\n')
}

type BackfillOutcome = Readonly<{
  source: string
  metric: string
  asOf: string
  result?: DailyBriefBackfillResult
  gapCode?: string
  detail?: string
}>

async function runBackfillRound(
  selection: unknown,
  input: DailyBriefAgentTurnInput,
  gaps: readonly DailyBriefDataGap[]
): Promise<readonly BackfillOutcome[] | undefined> {
  const raw = (selection as { backfill?: unknown }).backfill
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const byId = new Map(gaps.map((gap) => [gap.id, gap]))
  const cutoff = input.document.edition.windowEnd
  const outcomes: BackfillOutcome[] = []
  const seen = new Set<string>()
  let executed = 0
  for (const entry of raw) {
    const request = readBackfillRequest(entry)
    if (!request) {
      outcomes.push({ source: '', metric: '', asOf: '', gapCode: 'invalid-request', detail: 'a backfill entry must carry source, metric and asOf strings.' })
      continue
    }
    const id = `${request.source}:${request.metric}`
    if (seen.has(id)) continue
    seen.add(id)
    const gap = byId.get(id)
    if (!gap) {
      outcomes.push({ ...request, gapCode: 'not-a-gap', detail: 'that fact is not one of this edition\'s gaps.' })
      continue
    }
    if (!gap.requestable) {
      outcomes.push({ ...request, gapCode: 'source-disabled', detail: 'the reader turned this source off; the brief must not read around it.' })
      continue
    }
    if (!isCanonicalDailyBriefBackfillTime(request.asOf)) {
      outcomes.push({ ...request, gapCode: 'invalid-as-of', detail: 'asOf must be a canonical UTC instant.' })
      continue
    }
    if (request.asOf > cutoff) {
      outcomes.push({ ...request, gapCode: 'future-as-of', detail: `asOf is after the frozen cutoff ${cutoff}.` })
      continue
    }
    if (executed >= dailyBriefBackfillPolicy.maximumRequestsPerRound) {
      outcomes.push({ ...request, gapCode: 'round-limit', detail: `at most ${dailyBriefBackfillPolicy.maximumRequestsPerRound} requests per round.` })
      continue
    }
    if (!input.backfill) {
      outcomes.push({ ...request, gapCode: 'backfill-unwired', detail: 'no historical reader is attached to this build; the gap stays.' })
      continue
    }
    executed += 1
    let result: unknown
    try {
      result = await input.backfill(request)
    } catch {
      outcomes.push({ ...request, gapCode: 'query-unavailable', detail: 'the historical reader failed.' })
      continue
    }
    outcomes.push(acceptBackfill(result, request))
  }
  return Object.freeze(outcomes)
}

function readBackfillRequest(value: unknown): DailyBriefBackfillRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as { source?: unknown; metric?: unknown; asOf?: unknown }
  if (typeof record.source !== 'string' || typeof record.metric !== 'string' || typeof record.asOf !== 'string') return undefined
  return { source: record.source, metric: record.metric, asOf: record.asOf }
}

function acceptBackfill(value: unknown, request: DailyBriefBackfillRequest): BackfillOutcome {
  if (!isDailyBriefBackfillResult(value)) {
    return { ...request, gapCode: 'query-unavailable', detail: 'the reader returned an unrecognised answer.' }
  }
  if (value.source !== request.source || value.metric !== request.metric || value.asOf !== request.asOf) {
    return { ...request, gapCode: 'query-unavailable', detail: 'the reader answered a different request.' }
  }
  if (value.state === 'available' && value.observedAt > request.asOf) {
    return { ...request, gapCode: 'not-visible-as-of', detail: 'the answer was observed after the requested instant.' }
  }
  return { ...request, result: value }
}

function backfillMessage(outcomes: readonly BackfillOutcome[], cutoff: string): string {
  const lines = outcomes.map((outcome) => {
    const id = outcome.source && outcome.metric ? `${outcome.source}:${outcome.metric}` : 'invalid-request'
    if (outcome.result?.state === 'available') {
      return `- ${id} asOf=${outcome.result.asOf} -> value=${outcome.result.value} unit=${outcome.result.unit} observedAt=${outcome.result.observedAt} sourceUrl=${outcome.result.sourceUrl} method=${outcome.result.method}`
    }
    if (outcome.result?.state === 'unavailable') {
      return `- ${id} asOf=${outcome.result.asOf} -> GAP ${outcome.result.gapCode}: ${outcome.result.detail}`
    }
    return `- ${id}${outcome.asOf ? ` asOf=${outcome.asOf}` : ''} -> GAP ${outcome.gapCode ?? 'query-unavailable'}: ${outcome.detail ?? 'no answer'}`
  })
  return [
    `BACKFILL RESPONSE (frozen cutoff ${cutoff}; one round per edition):`,
    ...lines,
    'Backfilled values are context for ranking only: they are not in the frozen DOCUMENT, so do not cite them in prose and do not copy them into facts. A GAP means no value exists at that instant; never estimate one. Return the adjusted selection JSON now, without another backfill round.'
  ].join('\n')
}

function factSummary(document: DailyBriefingDocument, locale: DailyBriefingLocale): Readonly<{ kind: string; label: string; detail: string }> {
  const copy = dailyBriefSessionCopy(locale)
  const fill = dailyBriefSessionCopyText
  const macro = (document.news.macroCandidates ?? document.news.macro).map((item) => fill(copy.macroFact, {
    title: item.title, actual: item.actual ?? '—', consensus: item.consensus ?? copy.missing, previous: item.previous ?? '—'
  }))
  const news = document.news.items.map((item) => item.translatedTitle ?? item.title)
  const next = (document.next.candidates ?? [document.next.focus, ...document.next.items]).filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => fill(copy.nextFact, { title: item.title, at: item.at, country: item.countryName ? ` · ${item.countryName}` : '' }))
  const data = [...document.data.market, ...document.data.funds].map((row) => `${row.id} ${row.value?.number ?? '—'}`)
  const details = [
    fill(copy.window, { start: document.edition.windowStart, end: document.edition.windowEnd }),
    fill(copy.macroCandidates, { count: String(macro.length), items: macro.join(copy.listSeparator) || copy.empty }),
    fill(copy.newsCandidates, { count: String(news.length), items: news.join(copy.listSeparator) || copy.empty }),
    fill(copy.data, { items: data.join(copy.listSeparator) || copy.empty }),
    ...(document.data.leverage ? [fill(copy.leverage, { btc: String(document.data.leverage.btc.openInterestUsd ?? '—'), eth: String(document.data.leverage.eth.openInterestUsd ?? '—') })] : []),
    ...(document.data.policyPath ? [fill(copy.policyPath, { probability: String(Math.round(document.data.policyPath.probability)), outcome: document.data.policyPath.outcome, meetingDate: document.data.policyPath.meetingDate })] : []),
    fill(copy.conclusion, { summary: document.conclusion ? document.conclusion.summary.slice(0, 160) : copy.empty }),
    fill(copy.next, { items: next.join(copy.listSeparator) || copy.empty })
  ].join('\n')
  return Object.freeze({ kind: 'daily-briefing-facts', label: copy.factsLabel, detail: details.slice(0, 1600) })
}

function fieldResponse(document: DailyBriefingDocument, requests: readonly unknown[], locale: DailyBriefingLocale): string {
  const copy = dailyBriefSessionCopy(locale)
  const lines: string[] = []
  for (const raw of requests) {
    if (!raw || typeof raw !== 'object') continue
    const request = raw as { factId?: unknown; fields?: unknown }
    if (typeof request.factId !== 'string' || !Array.isArray(request.fields)) continue
    const fields = request.fields.filter((field): field is string => typeof field === 'string')
    const [kind, id] = request.factId.split(':')
    const item = kind === 'macro'
      ? document.news.macro.find((candidate) => candidate.eventKey === id)
      : kind === 'news'
        ? document.news.items.find((candidate) => candidate.itemId === id)
        : undefined
    const record = item as Record<string, unknown> | undefined
    lines.push(`${request.factId}: ${fields.map((field) => `${field}=${record && field in record ? String(record[field]) : copy.missing}`).join(copy.fieldSeparator)}`)
  }
  return lines.length > 0 ? lines.join('\n') : copy.unknownRequest
}

function selectDocument(document: DailyBriefingDocument, selection: unknown): DailyBriefingDocument {
  const value = selection as { news?: unknown; macro?: unknown; next?: unknown; focus?: unknown }
  const newsIds = Array.isArray(value.news) ? new Set(value.news.filter((item): item is string => typeof item === 'string')) : undefined
  const macroIds = Array.isArray(value.macro) ? new Set(value.macro.filter((item): item is string => typeof item === 'string')) : undefined
  const macroCandidates = document.news.macroCandidates ?? document.news.macro
  const nextCandidates = document.next.candidates ?? [document.next.focus, ...document.next.items].filter((item): item is NonNullable<typeof item> => Boolean(item))
  const nextKeys = Array.isArray(value.next) ? new Set(value.next.filter((item): item is string => typeof item === 'string')) : undefined
  const focusKey = typeof value.focus === 'string' ? value.focus : undefined
  const focus = focusKey ? nextCandidates.find((item) => item.eventKey === focusKey) : document.next.focus
  const selectedNext = nextKeys ? nextCandidates.filter((item) => nextKeys.has(item.eventKey) && item.eventKey !== focus?.eventKey) : document.next.items
  // Deterministic floor: the nearest upcoming event stays visible even if selection hid everything.
  const nextItems = selectedNext.length > 0 ? selectedNext : nextCandidates.slice(0, 1)
  const selectedNews = newsIds ? document.news.items.filter((item) => newsIds.has(`news:${item.itemId}`)) : document.news.items
  const selectedMacro = macroIds ? macroCandidates.filter((item) => macroIds.has(`macro:${item.eventKey}`)) : macroCandidates
  // The high-impact floor is unioned into selection. Dropping every release, or selecting only
  // lower-ranked ones, still leaves the key release for the writer to show or hide with a reason.
  const macroFloor = selectMacroFloorItem(macroCandidates)
  const macro = macroFloor && !selectedMacro.some((item) => item.eventKey === macroFloor.eventKey)
    ? [macroFloor, ...selectedMacro]
    : selectedMacro
  const shown = [...new Set([
    ...selectedNews.map((item) => `news:${item.itemId}`),
    ...macro.map((item) => `macro:${item.eventKey}`),
    ...(focus ? [focus.eventKey] : []),
    ...nextItems.map((item) => item.eventKey)
  ])]
  const hiddenEntries = Array.isArray((value as { hidden?: unknown }).hidden) ? (value as { hidden: unknown[] }).hidden : []
  const hiddenReason = new Map(hiddenEntries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const factId = (entry as { factId?: unknown }).factId
    const reason = (entry as { reason?: unknown }).reason
    return typeof factId === 'string' && typeof reason === 'string' && reason.trim().length > 0 ? [[factId, reason] as const] : []
  }))
  const allCandidates = [
    ...document.news.items.map((item) => `news:${item.itemId}`),
    ...macroCandidates.map((item) => `macro:${item.eventKey}`),
    ...nextCandidates.map((item) => item.eventKey)
  ]
  const shownIds = new Set(shown)
  const audit = Object.freeze({
    shown: Object.freeze(shown),
    hidden: Object.freeze(allCandidates.filter((factId) => !shownIds.has(factId)).map((factId) => Object.freeze({ factId, reason: hiddenReason.get(factId) ?? 'not selected' })))
  })
  return Object.freeze({
    ...document,
    news: Object.freeze({ ...document.news, items: Object.freeze(selectedNews), macro: Object.freeze(macro) }),
    next: Object.freeze({ ...document.next, ...(focus ? { focus } : {}), items: Object.freeze(nextItems) }),
    provenance: Object.freeze({ ...document.provenance, selectionAudit: audit })
  })
}

function unknownSelection(selection: unknown, document: DailyBriefingDocument): string | undefined {
  const value = selection as { news?: unknown; macro?: unknown; next?: unknown; focus?: unknown }
  const nextKeys = new Set((document.next.candidates ?? [document.next.focus, ...document.next.items].filter((item): item is NonNullable<typeof item> => Boolean(item))).map((item) => item.eventKey))
  const newsIds = new Set(document.news.items.map((item) => `news:${item.itemId}`))
  const macroIds = new Set((document.news.macroCandidates ?? document.news.macro).map((item) => `macro:${item.eventKey}`))
  if (typeof value.focus === 'string' && !nextKeys.has(value.focus)) return value.focus
  for (const key of ['news', 'macro', 'next'] as const) {
    const list = value[key]
    if (!Array.isArray(list)) continue
    for (const id of list) {
      if (typeof id !== 'string') return String(id)
      if (key === 'news' && !newsIds.has(id)) return id
      if (key === 'macro' && !macroIds.has(id)) return id
      if (key === 'next' && !nextKeys.has(id)) return id
    }
  }
  return undefined
}
