import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingPrompt, buildDailyBriefingSelectionPrompt } from './dailyBriefingPrompt'
import { applyDailyBriefingEditorial, validateDailyBriefingEditorial } from './dailyBriefingValidation'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { dailyBriefEditionKey, dailyBriefSessionCopy, dailyBriefSessionCopyText } from './dailyBriefEditorSessionNaming'

export type DailyBriefAgentTurnResult =
  | Readonly<{ state: 'accepted'; document: DailyBriefingDocument; sessionId: string; toolInvocations: readonly import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] }>
  | Readonly<{ state: 'failed'; failureCode: string; failureDetail?: string; sessionId: string; toolInvocations: readonly import('@platform/ai/agent-platform/runtime/runtimeTypes').AgentRuntimeToolInvocation[] }>

export async function runDailyBriefAgentTurn(input: Readonly<{
  runner: DailyBriefAgentRunner
  document: DailyBriefingDocument
  locale: DailyBriefingLocale
  allowedTools?: readonly string[]
}>): Promise<DailyBriefAgentTurnResult> {
  const editionKey = dailyBriefEditionKey(input.document.edition.date, input.locale)
  const copy = dailyBriefSessionCopy(input.locale)
  const summary = factSummary(input.document, input.locale)
  const selectionPrompt = buildDailyBriefingSelectionPrompt({ document: input.document, locale: input.locale })
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
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
  const requests = (selection as { requests?: unknown }).requests
  if (Array.isArray(requests) && requests.length > 0) {
    const answer = await input.runner.continue(started.sessionId, `FIELD RESPONSE:\n${fieldResponse(input.document, requests, input.locale)}\nReturn the next selection JSON if you need to adjust; otherwise continue.`)
    toolInvocations.push(...answer.toolInvocations)
    try {
      const adjusted = JSON.parse(answer.assistantText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
      if (adjusted && typeof adjusted === 'object' && (adjusted as { stage?: unknown }).stage === 'select') selection = adjusted
    } catch { /* keep the prior selection when the model just acknowledges */ }
  }
  const selectedDocument = selectDocument(input.document, selection)
  const prompt = buildDailyBriefingPrompt({ document: selectedDocument, locale: input.locale, selection })
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
  const written = await input.runner.continue(started.sessionId, prompt)
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

function factSummary(document: DailyBriefingDocument, locale: DailyBriefingLocale): Readonly<{ kind: string; label: string; detail: string }> {
  const copy = dailyBriefSessionCopy(locale)
  const fill = dailyBriefSessionCopyText
  const macro = (document.news.macroCandidates ?? document.news.macro).map((item) => fill(copy.macroFact, {
    title: item.title, actual: item.actual ?? '—', consensus: item.consensus ?? copy.missing, previous: item.previous ?? '—'
  }))
  const news = document.news.items.map((item) => item.translatedTitle ?? item.title)
  const data = [...document.data.market, ...document.data.funds].map((row) => `${row.id} ${row.value?.number ?? '—'}`)
  const next = (document.next.candidates ?? [document.next.focus, ...document.next.items]).filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => fill(copy.nextFact, { title: item.title, at: item.at, country: item.countryName ? ` · ${item.countryName}` : '' }))
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
  const nextCandidates = document.next.candidates ?? [document.next.focus, ...document.next.items].filter((item): item is NonNullable<typeof item> => Boolean(item))
  const nextKeys = Array.isArray(value.next) ? new Set(value.next.filter((item): item is string => typeof item === 'string')) : undefined
  const focusKey = typeof value.focus === 'string' ? value.focus : undefined
  const focus = focusKey ? nextCandidates.find((item) => item.eventKey === focusKey) : document.next.focus
  const selectedNext = nextKeys ? nextCandidates.filter((item) => nextKeys.has(item.eventKey) && item.eventKey !== focus?.eventKey) : document.next.items
  // Deterministic floor: the nearest upcoming event stays visible even if selection hid everything.
  const nextItems = selectedNext.length > 0 ? selectedNext : nextCandidates.slice(0, 1)
  const shown = [
    ...(newsIds ? [...newsIds] : document.news.items.map((item) => `news:${item.itemId}`)),
    ...(macroIds ? [...macroIds] : document.news.macro.map((item) => `macro:${item.eventKey}`)),
    ...(nextKeys ? [...nextKeys] : nextItems.map((item) => item.eventKey))
  ]
  const hiddenEntries = Array.isArray((value as { hidden?: unknown }).hidden) ? (value as { hidden: unknown[] }).hidden : []
  const hiddenReason = new Map(hiddenEntries.flatMap((entry) => entry && typeof entry === 'object' && typeof (entry as { factId?: unknown }).factId === 'string' && typeof (entry as { reason?: unknown }).reason === 'string' ? [[(entry as { factId: string }).factId, (entry as { reason: string }).reason] as const] : []))
  const allCandidates = [
    ...document.news.items.map((item) => `news:${item.itemId}`),
    ...document.news.macro.map((item) => `macro:${item.eventKey}`),
    ...nextCandidates.map((item) => item.eventKey)
  ]
  const audit = Object.freeze({ shown: Object.freeze(shown), hidden: Object.freeze(allCandidates.filter((id) => !shown.includes(id)).map((factId) => Object.freeze({ factId, reason: hiddenReason.get(factId) ?? 'not selected' }))) })
  return Object.freeze({
    ...document,
    news: Object.freeze({
      ...document.news,
      items: newsIds ? document.news.items.filter((item) => newsIds.has(`news:${item.itemId}`)) : document.news.items,
      macro: macroIds ? (document.news.macroCandidates ?? document.news.macro).filter((item) => macroIds.has(`macro:${item.eventKey}`)) : document.news.macro
    }),
    next: Object.freeze({ ...document.next, ...(focus ? { focus } : {}), items: Object.freeze(nextItems) }),
    provenance: Object.freeze({ ...document.provenance, selectionAudit: audit })
  })
}
