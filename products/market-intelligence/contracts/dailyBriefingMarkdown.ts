import type { BriefingMacroItem, BriefingMarketRow, BriefingNewsItem, BriefingNextItem, BriefingPulseRow, BriefingRowChange, DailyBriefingDocument } from './dailyBriefing'
import { formatBriefingChange, formatBriefingValue } from './dailyBriefingFormat'

export type DailyBriefingMarkdownLabels = Readonly<{
  title: string
  window: string
  edition: string
  readings: string
  readingsAllMissing: string
  noValue: string
  sections: Readonly<{ news: string; data: string; conclusion: string; basis: string; next: string }>
  tiers: Readonly<{ must: string; support: string; reference: string }>
  states: Readonly<Record<string, string>>
  reasons: Readonly<Record<string, string>>
  changeReasons: Readonly<Record<string, string>>
  /**
   * What a change is measured against, keyed by its window. A rolling 24/7 window reads `1d`; a
   * session close reads `vs prior session close`; a release reads `vs last publication`. The key is
   * the row's own window, so a row with no named window falls back to the raw token.
   */
  changeWindows: Readonly<Record<string, string>>
  /** The publication span behind a move, e.g. ` (10-30 → 10-31)`; `{from}`/`{to}` are the stamps. */
  changeBaselineSpan: string
  /** Unit suffixes for change values: a fear-and-greed move is points, not a percentage. */
  units: Readonly<{ points: string }>
  /** Captions for the level that sits behind a change-led row, e.g. `Total {value}`. */
  rowTotal: string
  rowCurrent: string
  rows: Readonly<Record<string, string>>
  empty: Readonly<{ news: string; macro: string; next: string; conclusion: string }>
  newsEmptyCodes: Readonly<Record<string, string>>
  macroEmptyCodes: Readonly<Record<string, string>>
  nextEmptyCodes: Readonly<Record<string, string>>
  macro: Readonly<{ actual: string; consensus: string; previous: string; noConsensus: string; surprise: Readonly<Record<string, string>> }>
  conclusion: Readonly<{ invalidation: string; conditions: string; counter: string; gaps: string; caveats: string }>
  next: Readonly<{ category: Readonly<Record<string, string>> }>
  citations: string
  translated: string
}>

/** The labels one row's copy needs; the full page copy satisfies this structurally. */
export type BriefingRowCopyLabels = Pick<DailyBriefingMarkdownLabels,
  'noValue' | 'changeReasons' | 'changeWindows' | 'changeBaselineSpan' | 'units' | 'rowTotal' | 'rowCurrent'>

export type DailyBriefingMarkdownOptions = Readonly<{
  labels: DailyBriefingMarkdownLabels
  locale: 'zh-CN' | 'en-US'
  direction: (term: string) => string
  eventTitle?: (item: Readonly<{ title: string; titleKey?: string }>) => string
  formatTime: (value: string) => string
}>

/**
 * The text edition: the same content as the overlay, with no charts, HTML or internal evidence ids.
 * It is the single source for copy and export, so a copied brief cannot disagree with the screen.
 */
export function dailyBriefingToMarkdown(document: DailyBriefingDocument, options: DailyBriefingMarkdownOptions): string {
  const { labels } = options
  const lines: string[] = []
  lines.push(`# ${escapeMarkdown(labels.title)} — ${document.edition.date}`)
  lines.push('')
  lines.push(`> ${labels.window.replace('{time}', options.formatTime(document.edition.windowEnd))} · ${labels.edition.replace('{time}', options.formatTime(document.edition.generatedAt))} · ${readingsLabel(document, labels)}`)
  if (document.lede.text) lines.push('', escapeMarkdown(document.lede.text))

  const visibleNews = document.news.items.filter((item) => item.visibility !== 'hidden')
  const visibleMacro = document.news.macro.filter((item) => item.visibility !== 'hidden')
  if (visibleNews.length > 0 || visibleMacro.length > 0) {
    lines.push('', `## ${labels.sections.news}`)
    for (const item of visibleNews) lines.push('', newsLine(item, options))
    for (const item of visibleMacro) lines.push('', macroLine(item, options))
  }

  const rows = dataRows(document)
  if (rows.length > 0) {
    lines.push('', `## ${labels.sections.data}`)
    for (const tier of ['must', 'support', 'reference'] as const) {
      const tierRows = rows.filter((row) => row.importance.tier === tier)
      if (tierRows.length === 0) continue
      lines.push('', `### ${labels.tiers[tier]}`)
      for (const row of tierRows) lines.push(dataLine(row, options))
    }
  }

  const conclusion = document.conclusion
  if (conclusion) {
    lines.push('', `## ${labels.sections.conclusion}`)
    lines.push('', `**${options.direction(conclusion.direction)}** ${escapeMarkdown(conclusion.summary)}`)
    if (conclusion.translation) lines.push('', `_${labels.translated}_ ${escapeMarkdown(conclusion.translation)}`)
    for (const invalidation of conclusion.invalidations) {
      lines.push(`- ${labels.conclusion.invalidation}: ${escapeMarkdown(invalidation.text)}`)
    }
    if (conclusion.conditions.length > 0) lines.push(`- ${labels.conclusion.conditions}: ${conclusion.conditions.map(escapeMarkdown).join(' · ')}`)
    for (const claim of conclusion.counterEvidence) {
      lines.push(`- ${labels.conclusion.counter}: ${escapeMarkdown(claim.statement)} ${claim.citations.map((index) => `[${index}]`).join('')}`.trimEnd())
    }
  }

  const nextItems = [document.next.focus, ...document.next.items].filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (nextItems.length > 0) {
    lines.push('', `## ${labels.sections.next}`)
    for (const item of nextItems) lines.push(nextLine(item, options))
  }

  lines.push('', '---')
  lines.push(`${labels.citations}:`)
  if (document.citations.length === 0) lines.push('- —')
  for (const entry of document.citations) {
    lines.push(`- [${entry.index}] ${[entry.statement, entry.sourceLabel ?? entry.refId, entry.observedAt ? options.formatTime(entry.observedAt) : undefined].filter(Boolean).join(' · ')}`)
  }
  lines.push(`${options.formatTime(document.provenance.readAt)}`)
  return `${lines.join('\n').trimEnd()}\n`
}

function dataRows(document: DailyBriefingDocument): Array<BriefingMarketRow | BriefingPulseRow> {
  // The copy must agree with the screen: hidden data rows are audited, not rendered.
  return [...document.data.market, ...document.data.funds, ...(document.data.sentiment.fearGreed ? [document.data.sentiment.fearGreed] : [])]
    .filter((row) => row.visibility !== 'hidden' && hasChangeToShow(row))
}

/** A change-led row with no comparable earlier value is omitted, never shown as a bare level. */
export function hasChangeToShow(row: BriefingMarketRow | BriefingPulseRow): boolean {
  return row.id !== 'stablecoin' && row.id !== 'fear-greed' ? true : row.change !== null
}

/**
 * Which number leads a data row, shared by the poster and this text edition.
 *
 * Stablecoin supply and fear-and-greed are read as moves, not levels: their headline is the 1d
 * change and the level becomes the caption. A row with no earlier observation says so with its
 * `no-baseline` label instead of printing the level as if it were a change. Every other row keeps
 * its own headline (a net flow, a 24h percentage, a yield level).
 */
export function changeLedRowCopy(
  row: BriefingMarketRow | BriefingPulseRow,
  labels: BriefingRowCopyLabels,
  locale = 'en-US'
): Readonly<{ primary: string; secondary: string }> | null {
  if (row.id !== 'stablecoin' && row.id !== 'fear-greed') return null
  // Without a level there is no caption, and the normal "no value" row is the honest rendering.
  if (row.value === null) return null
  const level = formatBriefingValue(row.value, labels.noValue, locale)
  const caption = (row.id === 'stablecoin' ? labels.rowTotal : labels.rowCurrent).replace('{value}', level)
  const reason = row.changeReason ? labels.changeReasons[row.changeReason] ?? '' : ''
  if (!row.change) return Object.freeze({ primary: reason || caption, secondary: reason ? caption : '' })
  const secondary = row.id === 'stablecoin'
    ? [caption, ...(row.auxiliaryChanges ?? []).map((change) => rowChangeText(change, labels, locale))].join(' · ')
    : caption
  return Object.freeze({ primary: rowChangeText(row.change, labels, locale, row), secondary })
}

/** A change value without its window, for rows whose headline is a level. */
export function formatRowChange(
  change: BriefingRowChange | null,
  labels: BriefingRowCopyLabels,
  locale: string
): string {
  if (!change) return ''
  const { unit, value } = change
  // A fear-and-greed move is index points, which has no percentage equivalent.
  return unit === 'points'
    ? `${value > 0 ? '+' : ''}${Math.round(value)} ${labels.units.points}`
    : formatBriefingChange({ value, unit }, locale)
}

/**
 * A change with what it is measured against, so a session close is never read as a 24-hour move and
 * a release is never read as a day-over-day move.
 *
 * The publication span is appended only when the baseline names a real instant and that instant is
 * on a different day: `vs last publication -2 pts (10-30 → 10-31)`. That is the honest alternative
 * to calling a three-day-old publication a `1d` move.
 */
function rowChangeText(
  change: BriefingRowChange,
  labels: BriefingRowCopyLabels,
  locale: string,
  row?: BriefingMarketRow | BriefingPulseRow
): string {
  const window = labels.changeWindows[change.window] ?? change.window
  return `${`${window} ${formatRowChange(change, labels, locale)}`.trim()}${publicationSpan(row, labels)}`
}

function publicationSpan(
  row: BriefingMarketRow | BriefingPulseRow | undefined,
  labels: BriefingRowCopyLabels
): string {
  if (!row || row.cadence !== 'publication-day' || !row.baselineAt || !row.observedAt) return ''
  const from = row.baselineAt.slice(5, 10)
  const to = row.observedAt.slice(5, 10)
  if (!from || !to || from === to) return ''
  return labels.changeBaselineSpan.replace('{from}', from).replace('{to}', to)
}

function readingsLabel(document: DailyBriefingDocument, labels: DailyBriefingMarkdownLabels): string {
  return document.status.readingsAvailable === 0
    ? labels.readingsAllMissing
    : labels.readings.replace('{available}', String(document.status.readingsAvailable)).replace('{total}', String(document.status.readingsTotal))
}

function newsLine(item: BriefingNewsItem, options: DailyBriefingMarkdownOptions): string {
  const title = escapeMarkdown(item.translatedTitle ?? item.title)
  return `- **${title}** — ${escapeMarkdown(item.sourceName)} · ${options.formatTime(item.publishedAt)} · ${item.polarity}`
}

function macroLine(item: BriefingMacroItem, options: DailyBriefingMarkdownOptions): string {
  const title = escapeMarkdown(options.eventTitle ? options.eventTitle(item) : item.title)
  const surprise = options.labels.macro.surprise[item.surprise.direction] ?? item.surprise.direction
  return `- **${title}** — ${options.formatTime(item.scheduledAt)} · ${options.labels.macro.actual} ${item.actual ?? '—'} · ${options.labels.macro.consensus} ${item.consensus ?? options.labels.macro.noConsensus} · ${options.labels.macro.previous} ${item.previous ?? '—'} · ${surprise}`
}

function dataLine(row: BriefingMarketRow | BriefingPulseRow, options: DailyBriefingMarkdownOptions): string {
  const label = rowLabel(row.labelKey, options.labels)
  if (row.state === 'available' || row.state === 'stale') {
    const copy = changeLedRowCopy(row, options.labels, options.locale)
    if (copy) {
      const meta = [copy.secondary, row.state === 'stale' ? options.labels.states.stale ?? '' : '']
        .filter(Boolean).join(' · ')
      return `- ${label}: ${copy.primary}${meta ? ` (${meta})` : ''}`
    }
    const value = formatBriefingValue(row.value, options.labels.noValue, options.locale)
    const change = row.change ? rowChangeText(row.change, options.labels, options.locale, row) : ''
    const reason = row.changeReason ? options.labels.changeReasons[row.changeReason] ?? '' : ''
    const suffix = [change, reason, row.state === 'stale' ? options.labels.states.stale ?? '' : ''].filter(Boolean).join(' · ')
    return `- ${label}: ${value}${suffix ? ` (${suffix})` : ''}`
  }
  const state = row.state === 'source-disabled' ? options.labels.states['source-disabled'] : options.labels.states.unavailable
  const reason = row.reason ? options.labels.reasons[row.reason] ?? '' : ''
  return `- ${label}: ${state}${reason ? ` · ${reason}` : ''}`
}

function nextLine(item: BriefingNextItem, options: DailyBriefingMarkdownOptions): string {
  const title = escapeMarkdown(options.eventTitle ? options.eventTitle(item) : item.title)
  return `- ${options.formatTime(item.at)} **${title}** · ${options.labels.next.category[item.category] ?? item.category}`
}

function emptyNews(document: DailyBriefingDocument, labels: DailyBriefingMarkdownLabels): string {
  const code = document.news.notes.newsEmpty
  return code ? labels.newsEmptyCodes[code] ?? labels.empty.news : labels.empty.news
}

function nextEmpty(document: DailyBriefingDocument, labels: DailyBriefingMarkdownLabels): string {
  const code = document.next.note
  return code ? labels.nextEmptyCodes[code] ?? labels.empty.next : labels.empty.next
}

function rowLabel(labelKey: string, labels: DailyBriefingMarkdownLabels): string {
  return labels.rows[labelKey.split('.').pop() ?? ''] ?? labelKey
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}
