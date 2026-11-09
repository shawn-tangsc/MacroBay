import type {
  BriefingMacroItem,
  BriefingMarketRow,
  BriefingNextItem,
  BriefingPulseRow,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'
import { formattedClock, unavailableRowCopy } from './dailyBriefingUnavailableRow'
import { briefingMacroEmptyCopy } from './briefingMacroEmptyCopy'
import { coreMetricLabel, eventTitle, fillTemplate, rowLabel, rowSource } from './dailyBriefingIssueLabels'
import { collectMacroIssues } from './briefingIssueMacro'

/**
 * What limited this edition, derived from the document that was actually generated.
 *
 * The reader must not have to guess why a row is missing or why a change is not shown. Every entry
 * here names the fact it limited, where it came from, when it was observed and what the reader can
 * do about it. The derivation is pure: it reads the frozen document and the page's existing
 * settings, never a source, a store or a model.
 */
export type BriefingIssueSeverity = 'blocking' | 'warning' | 'info'
export type BriefingIssueCategory = 'data' | 'baseline' | 'backfill' | 'ai' | 'evidence' | 'system' | 'timing'

/**
 * The copy template an issue was rendered from. Grouping uses this, not the filled title: two
 * consensus gaps on different events are one limitation, while a stale row and a disabled source
 * are different ones even when both concern the same row.
 */
export type BriefingIssueTemplate =
  | 'row-disabled' | 'row-unavailable' | 'row-stale' | 'row-no-value' | 'etf-no-history' | 'capital-gate'
  | 'no-baseline' | 'no-baseline-last-release' | 'insufficient-window'
  | 'news-disabled' | 'news-unavailable' | 'news-source-silent' | 'news-source-failed'
  | 'calendar-disabled' | 'calendar-unavailable'
  | 'macro-consensus' | 'macro-actual' | 'macro-previous' | 'macro-value-conflict'
  | 'backfill-done' | 'backfill-generic'
  | 'ai-fallback' | 'ai-websearch' | 'ai-failure' | 'source-failure' | 'system-failure' | 'document-invalid'
  | 'evidence-gap' | 'evidence-caveat' | 'evidence-no-citation' | 'evidence-conflict' | 'evidence-none'
  | 'timing-late' | 'macro-quiet'

/** The stable code behind a template; two templates may share a code but never a group. */
export const briefingIssueTemplateCodes: Readonly<Record<BriefingIssueTemplate, string>> = {
  'row-disabled': 'source-disabled', 'row-unavailable': 'unavailable', 'row-stale': 'stale',
  'row-no-value': 'no-value', 'etf-no-history': 'etf-unavailable', 'capital-gate': 'capital-gate',
  'no-baseline': 'no-baseline', 'no-baseline-last-release': 'no-baseline', 'insufficient-window': 'insufficient-window',
  'news-disabled': 'source-disabled', 'news-unavailable': 'unavailable',
  // 静默与连续失败**两个模板、两个码**：句子不许共用，分组也不许合并。
  'news-source-silent': 'source-silent', 'news-source-failed': 'source-failed',
  'calendar-disabled': 'source-disabled', 'calendar-unavailable': 'unavailable',
  'macro-consensus': 'consensus-missing', 'macro-actual': 'actual-missing', 'macro-previous': 'previous-missing',
  'macro-value-conflict': 'value-conflict',
  'backfill-done': 'backfill', 'backfill-generic': 'backfill',
  'ai-fallback': 'model-fallback', 'ai-websearch': 'websearch-off', 'ai-failure': 'editorial-failure',
  'source-failure': 'source-failed',
  'system-failure': 'generation-failure', 'document-invalid': 'document-invalid',
  'evidence-gap': 'data-gap', 'evidence-caveat': 'data-caveat', 'evidence-no-citation': 'uncited-counter-evidence',
  'evidence-conflict': 'source-conflict', 'evidence-none': 'no-citations',
  'timing-late': 'late-generation',
  // A quiet window is not a gap: its own code so it can never merge with an unreadable calendar.
  'macro-quiet': 'macro-quiet'
}

export type BriefingIssue = Readonly<{
  id: string
  severity: BriefingIssueSeverity
  category: BriefingIssueCategory
  code: string
  template: BriefingIssueTemplate
  /** The source the limited fact came from, e.g. a provider or the AI editor. */
  source: string
  /** When the fact was observed, or when the edition checked it. */
  at: string
  title: string
  advice: string
}>

export type BriefingIssueInput = Readonly<{
  document: DailyBriefingDocument
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  eventTitles?: Record<string, string>
  /** The brief's WebSearch authorization, read by the page from its existing settings. */
  webSearchEnabled?: boolean | null
}>

const severityRank: Readonly<Record<BriefingIssueSeverity, number>> = { blocking: 0, warning: 1, info: 2 }
const categoryRank: Readonly<Record<BriefingIssueCategory, number>> = {
  data: 0, baseline: 1, backfill: 2, ai: 3, evidence: 4, system: 5, timing: 6
}

/** Deterministic, grouped reading order: severity first, then the kind of limitation. */
export function briefingIssues(input: BriefingIssueInput): readonly BriefingIssue[] {
  const issues = new Map<string, BriefingIssue>()
  const fallbackAt = input.document.edition.generatedAt
  const add = (issue: Omit<BriefingIssue, 'at' | 'code'> & Readonly<{ at?: string }>): void => {
    const complete = Object.freeze({
      ...issue,
      code: briefingIssueTemplateCodes[issue.template],
      at: issue.at || fallbackAt
    })
    if (!issues.has(complete.id)) issues.set(complete.id, complete)
  }
  collectRows(input, add)
  collectNewsAndCalendar(input, add)
  collectMacroIssues(input, add)
  collectBackfill(input, add)
  collectEditorial(input, add)
  collectEvidence(input, add)
  collectTiming(input, add)
  return Object.freeze([...issues.values()].sort(compare))
}

export function briefingIssueCounts(issues: readonly BriefingIssue[]): Readonly<Record<BriefingIssueSeverity, number>> {
  const counts = { blocking: 0, warning: 0, info: 0 }
  for (const issue of issues) counts[issue.severity] += 1
  return Object.freeze(counts)
}

/** One summary row: every issue with the same category, code and copy template. */
export type BriefingIssueGroup = Readonly<{
  key: string
  category: BriefingIssueCategory
  code: string
  template: BriefingIssueTemplate
  severity: BriefingIssueSeverity
  label: string
  count: number
  /** The first issue's title, shown as the summary's one example. */
  example: string
  issues: readonly BriefingIssue[]
}>

/**
 * Groups the issue list for the rail. The rail shows one row per group, so an edition with seven
 * consensus gaps is one line, not seven. Blocking groups sort first; an empty group cannot exist.
 */
export function groupBriefingIssues(
  issues: readonly BriefingIssue[],
  text: DailyBriefingText
): readonly BriefingIssueGroup[] {
  const buckets = new Map<string, BriefingIssue[]>()
  for (const issue of issues) {
    const key = `${issue.category}\u0000${issue.code}\u0000${issue.template}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(issue)
    else buckets.set(key, [issue])
  }
  const groups = [...buckets.entries()].map(([key, bucket]): BriefingIssueGroup => {
    const sorted = [...bucket].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))
    const first = sorted[0]!
    const severity = sorted.reduce<BriefingIssueSeverity>(
      (highest, issue) => severityRank[issue.severity] < severityRank[highest] ? issue.severity : highest,
      first.severity
    )
    return Object.freeze({
      key,
      category: first.category,
      code: first.code,
      template: first.template,
      severity,
      label: text.limits.groupLabels[first.template],
      count: sorted.length,
      example: first.title,
      issues: Object.freeze(sorted)
    })
  })
  return Object.freeze(groups.sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity] ||
    categoryRank[left.category] - categoryRank[right.category] ||
    right.count - left.count ||
    left.key.localeCompare(right.key)))
}

function compare(left: BriefingIssue, right: BriefingIssue): number {
  return severityRank[left.severity] - severityRank[right.severity] ||
    categoryRank[left.category] - categoryRank[right.category] ||
    left.at.localeCompare(right.at) ||
    left.id.localeCompare(right.id)
}

type AddIssue = (issue: Omit<BriefingIssue, 'at' | 'code'> & Readonly<{ at?: string }>) => void

function collectRows(input: BriefingIssueInput, add: AddIssue): void {
  const { document, text } = input
  const rows: readonly (BriefingMarketRow | BriefingPulseRow)[] = [
    ...document.data.market,
    ...document.data.funds,
    ...(document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : [])
  ]
  for (const row of rows) {
    const label = rowLabel(text, row.labelKey)
    const source = rowSource(row.id, text)
    const at = row.observedAt ?? document.edition.generatedAt
    if (row.state === 'source-disabled') {
      add({
        id: `data:${row.id}:disabled`, severity: 'warning', category: 'data', template: 'row-disabled', source, at,
        title: fillTemplate(text.limits.row.disabled, { row: label }), advice: text.limits.advice.enableSource
      })
      continue
    }
    if (row.state === 'unavailable') {
      const copy = unavailableRowCopy({
        text, label, rowId: row.id, ...(row.reason ? { reason: row.reason } : {}),
        cutoff: formattedClock(input.formatTime(input.document.edition.windowEnd, 'minute'))
      })
      add({
        id: `data:${row.id}:unavailable`, severity: 'warning', category: 'data', source, at,
        template: copy.template, title: copy.title, advice: copy.advice
      })
      continue
    }
    if (row.state === 'stale') {
      add({
        id: `data:${row.id}:stale`, severity: 'warning', category: 'data', template: 'row-stale', source, at,
        title: fillTemplate(text.limits.row.stale, { row: label, time: input.formatTime(at, 'minute') }),
        advice: text.limits.advice.checkSource
      })
    } else if (row.value === null) {
      add({
        id: `data:${row.id}:no-value`, severity: 'warning', category: 'data', template: 'row-no-value', source, at,
        title: fillTemplate(text.limits.row.noValue, { row: label }), advice: text.limits.advice.waitCollection
      })
    }
    if (row.changeReason) collectChangeReason(input, add, row, label, source)
  }
}

/** A change that exists in principle but cannot be shown is explained, never left blank. */
function collectChangeReason(
  input: BriefingIssueInput,
  add: AddIssue,
  row: BriefingMarketRow | BriefingPulseRow,
  label: string,
  source: string
): void {
  const { document, text } = input
  const at = row.observedAt ?? document.edition.generatedAt
  const insufficient = row.changeReason === 'insufficient-window'
  let template: BriefingIssueTemplate = insufficient ? 'insufficient-window' : 'no-baseline'
  let title = fillTemplate(insufficient ? text.limits.row.insufficientWindow : text.limits.row.noBaseline, { row: label })
  if (!insufficient && row.id === 'fear-greed' && row.observedAt) {
    const elapsed = Date.parse(document.edition.windowEnd) - Date.parse(row.observedAt)
    if (Number.isFinite(elapsed) && elapsed > 0) {
      template = 'no-baseline-last-release'
      title = fillTemplate(text.limits.row.noBaselineLastRelease, {
        row: label,
        time: input.formatTime(row.observedAt, 'minute'),
        interval: intervalText(elapsed, text)
      })
    }
  }
  add({
    id: `baseline:${row.id}:${insufficient ? 'insufficient-window' : 'no-baseline'}`,
    severity: 'warning', category: 'baseline', template, source, at, title,
    advice: insufficient ? text.limits.advice.widenWindow : text.limits.advice.waitNextRelease
  })
}

function collectNewsAndCalendar(input: BriefingIssueInput, add: AddIssue): void {
  const { document, text } = input
  const at = document.edition.generatedAt
  const news = document.data.sentiment.news.state
  if (news === 'source-disabled') {
    add({ id: 'data:news:disabled', severity: 'warning', category: 'data', template: 'news-disabled', source: text.limits.sources.news, at, title: text.limits.newsDisabled, advice: text.limits.advice.checkNews })
  } else if (news === 'unavailable') {
    add({ id: 'data:news:unavailable', severity: 'warning', category: 'data', template: 'news-unavailable', source: text.limits.sources.news, at, title: text.limits.newsUnavailable, advice: text.limits.advice.checkNews })
  }
  // 来源静默与来源失败（`02` v2.167）：都从冻结文档的 `news.sources` 派生，两件事两句话。
  // 正常的源不进文档，也就不会出现在这里——没有条目不是"缺了什么"。
  for (const source of document.news.sources ?? []) {
    if (source.state === 'silent') {
      add({
        id: `data:news-source:silent:${source.sourceId}`,
        severity: 'warning', category: 'data', template: 'news-source-silent',
        source: source.name,
        ...(source.lastNewItemAt === undefined ? {} : { at: source.lastNewItemAt }),
        title: text.limits.newsSourceSilent
          .replace('{source}', source.name)
          .replace('{hours}', String(source.silentHours ?? ''))
          .replace('{time}', source.lastNewItemAt === undefined ? '' : input.formatTime(source.lastNewItemAt, 'minute')),
        advice: text.limits.advice.checkSource
      })
      continue
    }
    add({
      id: `data:news-source:failed:${source.sourceId}`,
      severity: 'warning', category: 'data', template: 'news-source-failed',
      source: source.name,
      title: text.limits.newsSourceFailed
        .replace('{source}', source.name)
        .replace('{count}', String(source.consecutiveFailures ?? 0)),
      advice: text.limits.advice.checkSource
    })
  }
  // 宏观那栏为什么空：**与正文共用同一个推导**（`briefingMacroEmptyCopy`），所以读者在两处
  // 读到的是同一句话。以前这里把六档原因码压成两句，过期/从未采集/采集失败全被静默吞掉。
  const macroEmpty = briefingMacroEmptyCopy(document, {
    macroEmptyCodes: text.macroEmptyCodes,
    macroUnreadable: text.macroUnreadable
  })
  // 「确实没有高影响事件」：正文不印（`briefingMacroEmptyCopy` 仍返回 null），这里只记一条
  // info 留痕，让查账的人看出不是漏了。没有动作、不是告警，也不与「读不到」共用一个码。
  if (document.news.notes.macroEmpty === 'past-24h-no-high-impact-release') {
    const hours = document.edition.windowHours ?? 24
    add({
      id: 'data:macro:quiet',
      severity: 'info',
      category: 'data',
      template: 'macro-quiet',
      source: text.limits.sources.calendar,
      at,
      title: text.limits.macroQuiet.replace('{hours}', String(hours)),
      advice: text.limits.advice.macroQuiet
    })
  }
  if (macroEmpty?.unreadable) {
    const code = document.news.notes.macroEmpty ?? 'calendar-unavailable'
    add({ id: `data:calendar:${code}`, severity: 'warning', category: 'data', template: 'calendar-unavailable', source: text.limits.sources.calendar, at, title: macroEmpty.sentence, advice: text.limits.advice.checkCalendar })
  }
  // 「接下来 7 日」那一段只由它自己的 note 说明，与上面那栏不是同一件事，照旧单独报。
  const nextNote = document.next.note
  if (document.news.notes.macroEmpty === undefined && nextNote === 'calendar-source-disabled') {
    add({ id: 'data:calendar:disabled', severity: 'warning', category: 'data', template: 'calendar-disabled', source: text.limits.sources.calendar, at, title: text.limits.calendarDisabled, advice: text.limits.advice.checkCalendar })
  } else if (document.news.notes.macroEmpty === undefined && nextNote === 'calendar-unavailable') {
    add({ id: 'data:calendar:unavailable', severity: 'warning', category: 'data', template: 'calendar-unavailable', source: text.limits.sources.calendar, at, title: text.limits.calendarUnavailable, advice: text.limits.advice.checkCalendar })
  }
}

/** The successful core-fact backfill is recorded in `provenance.supplements`, so it is audited. */
function collectBackfill(input: BriefingIssueInput, add: AddIssue): void {
  const { text } = input
  for (const [index, supplement] of (input.document.provenance.supplements ?? []).entries()) {
    const parsed = /^filled (\d+) core data rows: (.+)$/.exec(supplement.reason)
    const rows = parsed
      ? parsed[2].split(',').map((metric) => coreMetricLabel(metric.trim(), text)).filter(Boolean)
      : []
    add({
      id: `backfill:${supplement.at}:${index}`,
      severity: 'info',
      category: 'backfill',
      template: parsed && rows.length > 0 ? 'backfill-done' : 'backfill-generic',
      source: text.limits.sources.backfill,
      at: supplement.at,
      title: parsed && rows.length > 0
        ? fillTemplate(text.limits.backfill.done, { count: parsed[1] ?? String(rows.length), rows: rows.join(text.limits.listSeparator) })
        : text.limits.backfill.generic,
      advice: text.limits.advice.backfill
    })
  }
}

function collectEditorial(input: BriefingIssueInput, add: AddIssue): void {
  const { document, text } = input
  const meta = document.provenance.editorialMeta
  if (meta?.fallback === 'custom-unavailable') {
    add({
      id: 'ai:model-fallback', severity: 'warning', category: 'ai', template: 'ai-fallback', source: text.limits.sources.editorial,
      at: document.edition.generatedAt, title: text.limits.ai.fallback, advice: text.limits.advice.modelFallback
    })
  }
  if (input.webSearchEnabled === false && meta) {
    add({
      id: 'ai:websearch-off', severity: 'info', category: 'ai', template: 'ai-websearch', source: text.limits.sources.editorial,
      at: document.edition.generatedAt, title: text.limits.ai.webSearchOff, advice: text.limits.advice.webSearch
    })
  }
  const failure = document.provenance.editorialFailure
  if (!failure || failure === 'editorial-disabled') return
  const category: BriefingIssueCategory = systemFailureCodes.has(failure)
    ? 'system'
    : failure === 'source-failed' ? 'data' : 'ai'
  const reason = (text.aiSettings.failure as Readonly<Record<string, string>>)[failure] ?? text.failurePanel.unknownCode
  add({
    id: `${category}:editorial-failure:${failure}`,
    severity: 'blocking',
    category,
    template: category === 'system' ? 'system-failure' : category === 'data' ? 'source-failure' : 'ai-failure',
    source: category === 'data' ? text.limits.sources.collector : category === 'system' ? text.limits.sources.system : text.limits.sources.editorial,
    at: document.edition.generatedAt,
    title: category === 'system'
      ? fillTemplate(text.limits.system.failure, { reason })
      : category === 'data' ? reason : fillTemplate(text.limits.ai.failure, { reason }),
    advice: category === 'system'
      ? text.limits.advice.system
      : category === 'data' ? text.limits.advice.checkSource : text.limits.advice.retryAi
  })
}

const systemFailureCodes: ReadonlySet<string> = new Set([
  'candidate-overflow', 'store-failed', 'time-invalid', 'build-failed', 'timeout'
])

/**
 * The published conclusion's own gaps and caveats stay, because they are the only record of an
 * evidence truncation. They are deduplicated against each other and carry the analysis source.
 */
function collectEvidence(input: BriefingIssueInput, add: AddIssue): void {
  const { document, text } = input
  const conclusion = document.conclusion
  if (!conclusion) return
  for (const gap of conclusion.dataGaps) {
    const value = gap.trim()
    if (!value) continue
    add({
      id: `evidence:${value}`, severity: 'info', category: 'evidence', template: 'evidence-gap', source: text.limits.sources.analysis,
      at: conclusion.publishedAt, title: fillTemplate(text.limits.evidence.gap, { text: value }), advice: text.limits.advice.evidence
    })
  }
  for (const caveat of conclusion.caveats) {
    const value = caveat.trim()
    if (!value) continue
    add({
      id: `evidence:${value}`, severity: 'info', category: 'evidence', template: 'evidence-caveat', source: text.limits.sources.analysis,
      at: conclusion.publishedAt, title: fillTemplate(text.limits.evidence.caveat, { text: value }), advice: text.limits.advice.evidence
    })
  }
  for (const claim of conclusion.counterEvidence) {
    if (claim.citations.length > 0 || !claim.statement.trim()) continue
    add({
      id: `evidence:claim:${claim.statement}`, severity: 'warning', category: 'evidence', template: 'evidence-no-citation',
      source: text.limits.sources.analysis, at: conclusion.publishedAt,
      title: fillTemplate(text.limits.evidence.noCitation, { text: clip(claim.statement) }),
      advice: text.limits.advice.citeEvidence
    })
  }
  for (const entry of document.citations) {
    const statement = entry.statement ?? ''
    if (!/\(source conflict\)/i.test(statement)) continue
    add({
      id: `evidence:conflict:${entry.index}`, severity: 'warning', category: 'evidence', template: 'evidence-conflict',
      source: text.limits.sources.webSearch, at: entry.observedAt ?? conclusion.publishedAt,
      title: fillTemplate(text.limits.evidence.conflict, { text: clip(statement.replace(/\s*\(source conflict\)\s*/i, '')) }),
      advice: text.limits.advice.officialSource
    })
  }
  if (document.citations.length === 0) {
    add({
      id: 'evidence:no-citations', severity: 'info', category: 'evidence', template: 'evidence-none', source: text.limits.sources.analysis,
      at: conclusion.publishedAt, title: text.limits.evidence.none, advice: text.limits.advice.evidence
    })
  }
}

/** A brief generated long after its cutoff says so: the delay is part of reading the numbers. */
function collectTiming(input: BriefingIssueInput, add: AddIssue): void {
  const { document, text } = input
  const generated = Date.parse(document.edition.generatedAt)
  const cutoff = Date.parse(document.edition.windowEnd)
  const delay = generated - cutoff
  if (!Number.isFinite(delay) || delay < 15 * 60 * 1_000) return
  add({
    id: 'timing:late-generation', severity: 'info', category: 'timing', template: 'timing-late', source: text.limits.sources.settings,
    at: document.edition.generatedAt,
    title: fillTemplate(text.limits.timing.late, { interval: intervalText(delay, text) }),
    advice: text.limits.advice.keepRunning
  })
}

function intervalText(elapsedMs: number, text: DailyBriefingText): string {
  const minutes = Math.max(1, Math.round(elapsedMs / 60_000))
  if (minutes < 60) return fillTemplate(text.limits.interval.minutes, { count: String(minutes) })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return fillTemplate(text.limits.interval.hours, { count: String(hours) })
  return fillTemplate(text.limits.interval.days, { count: String(Math.round(hours / 24)) })
}

function clip(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed
}


