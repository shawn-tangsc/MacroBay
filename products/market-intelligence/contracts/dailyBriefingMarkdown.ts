import { dailyBriefingPolicy } from './dailyBriefing/policies'
import { editionNewsTitle, editionNewsTitleIsOriginal } from './dailyBriefing/readings'
import { briefingMacroValueLabel } from './dailyBriefingMacroValueText'
import { briefingEditionPeriod, type BriefingMacroItem, type BriefingMarketRow, type BriefingNewsItem, type BriefingNextItem, type BriefingPulseRow, type BriefingRowChange, type DailyBriefingDocument } from './dailyBriefing'
import { formatBriefingChange, formatBriefingValue } from './dailyBriefingFormat'
import { briefingDataGroups, briefingDataRowsFromGroups } from './dailyBriefingDataGroups'
import { briefRowFigures, formatRowMove } from './dailyBriefingRowFigures'

export type DailyBriefingMarkdownLabels = Readonly<{
  title: string
  window: string
  edition: string
  /** The period this edition belongs to, e.g. `期 {time}（定期）`; omitted for the `default` period. */
  periodScheduled: string
  periodManual: string
  /**
   * The edition language, so a copied brief says which version it is. Optional: a caller that has no
   * name table prints the locale tag rather than a blank, and the screen's own copy is not affected.
   */
  languageNames?: Readonly<Record<string, string>>
  readingsAllMissing: string
  /** 价格那两行读的是永续合约：正文标了，复制文本也要标。 */
  perpetualContract: string
  /**
   * 持仓块里那个 `$…B` 是什么：未平仓合约的**名义额**（美元），不是张数、不是成交量。
   * 卡片名已经这么写（`positioningChange`），复制文本同样要写——只留一个 `$` 金额，读者认不出它是什么量。
   */
  leverageOpenInterest: string
  /** 必须显示的读数超过阈值时说的那句「今天信息较多」。 */
  denseDay: string
  /** 纳指那行读的是代币化永续代理时，标题后带的那句（正文卡片也用它）。 */
  indexProxy: string
  /** 中文版没有译文时标在标题后的两个字；英文版是 "Original"。 */
  newsOriginal: string
  noValue: string
  sections: Readonly<{ news: string; data: string; conclusion: string; basis: string; next: string; leverage: string; policyPath: string }>
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
  empty: Readonly<{ news: string; next: string; conclusion: string }>
  newsEmptyCodes: Readonly<Record<string, string>>
  macroEmptyCodes: Readonly<Record<string, string>>
  nextEmptyCodes: Readonly<Record<string, string>>
  macro: Readonly<{ actual: string; consensus: string; previous: string; noConsensus: string; surprise: Readonly<Record<string, string>> }>
  /** 网页取到的值的来源后缀（`02` v2.128）：正文/导出/复制三处同一份。 */
  macroWebValue: string
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
  /**
   * 这一期没有 AI 解读时要带上的那句说明（r17）。屏幕上有、复制出去没有，读者发出去的
   * 就是一份"看起来完整"的日报——所以它必须和页面、导出的图是同一句话。
   */
  editorialNotice?: string
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
  // The header says when this edition covers, not how many items it holds: the body lists them, so a
  // count here repeated a fact the reader can already see (and named no unit).
  const allMissing = document.status.readingsAvailable === 0 ? ` · ${labels.readingsAllMissing}` : ''
  // 一天多期之后，「日期 + 窗口」不足以说明这是哪一份：同一天可以是 07:00 的 24h 与 07:00 的 4h，
  // 也可以同刻同窗口只是语言不同。头部因此把这一期自己的身份写全——截止时刻、窗口、期、语言。
  const period = briefingEditionPeriod(document.edition)
  const periodLabel = period.periodId === 'default'
    ? ''
    : ` · ${(period.periodKind === 'manual' ? labels.periodManual : labels.periodScheduled).replace('{time}', options.formatTime(period.periodTime))}`
  const language = labels.languageNames?.[document.edition.locale] ?? document.edition.locale
  lines.push(`> ${labels.window.replace('{time}', options.formatTime(document.edition.windowEnd))} · ${labels.edition.replace('{time}', options.formatTime(document.edition.generatedAt))}${periodLabel} · ${language}${allMissing}`)
  // 单独一段，不用引用块：复制头部那行 `> …` 说的是「这一期是什么」，这句说的是「缺了什么」。
  if (options.editorialNotice) lines.push('', escapeMarkdown(options.editorialNotice))
  if (document.lede.text) lines.push('', escapeMarkdown(document.lede.text))

  const visibleNews = document.news.items.filter((item) => item.visibility !== 'hidden')
  const visibleMacro = document.news.macro.filter((item) => item.visibility !== 'hidden')
  if (visibleNews.length > 0 || visibleMacro.length > 0) {
    lines.push('', `## ${labels.sections.news}`)
    for (const item of visibleNews) lines.push('', newsLine(item, options))
    for (const item of visibleMacro) lines.push('', macroLine(item, options))
  }

  const rows = briefingDataRows(document)
  if (rows.length > 0) {
    lines.push('', `## ${labels.sections.data}`)
    // 与海报同一条判据：必须显示的读数超过阈值，就明说这一天很密。
    if (rows.filter((row) => row.importance.tier === 'must').length > dailyBriefingPolicy.denseDayMustRows) lines.push('', labels.denseDay)
    for (const tier of ['must', 'support', 'reference'] as const) {
      const tierRows = rows.filter((row) => row.importance.tier === tier)
      if (tierRows.length === 0) continue
      lines.push('', `### ${labels.tiers[tier]}`)
      for (const row of tierRows) lines.push(dataLine(row, options))
    }
    // The card prints these two blocks; the copied text is the same edition, so it prints them too.
    // Their absence here was the "page one thing, export another" defect reported on 2026-11-04.
    if (document.data.leverage && document.data.leverage.visibility !== 'hidden') {
      const leverage = document.data.leverage
      lines.push('', `### ${labels.sections.leverage}`)
      for (const [asset, key, entry] of [['BTC', 'btc', leverage.btc], ['ETH', 'eth', leverage.eth]] as const) {
        const openInterest = entry.openInterestUsd === undefined ? labels.noValue : `$${(entry.openInterestUsd / 1e9).toFixed(2)}B`
        const day = entry.change24hPct === undefined ? labels.noValue : `${entry.change24hPct.toFixed(1)}%`
        // The rate travels with the block that explains it, exactly as on the card.
        const rate = briefingDataGroups(document).funding.find((row) => row.id === `funding-${key}`)?.value?.number
        const fee = rate === undefined ? labels.noValue : `${rate > 0 ? '+' : ''}${rate.toFixed(4)}%`
        lines.push(`- ${asset} · ${fee} · ${labels.leverageOpenInterest} ${openInterest} · ${day}`)
      }
    }
    if (document.data.policyPath && document.data.policyPath.visibility !== 'hidden') {
      const path = document.data.policyPath
      lines.push('', `### ${labels.sections.policyPath}`)
      lines.push(`${Math.round(path.probability)}% · ${path.meetingDate}${path.targetLower !== undefined ? ` · ${path.targetLower}–${path.targetUpper}%` : ''}`)
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

/**
 * The rows the data region shows, for both exports.
 *
 * One function, because the exported image and the copied text are the same edition: two renderers
 * each deciding what to print is how the leverage block and the rate path came to exist in the card
 * and be missing from the markdown. Readiness already decided presence; nothing here filters on "does
 * this row have a change", which silently dropped stablecoin and fear-and-greed on quiet days.
 */
/**
 * The data region's rows, derived from the one partition.
 *
 * Derived, not re-walked: a second traversal of `document.data.*` is how the funding rate came to be
 * printed twice — once in the funds block and once in the leverage card.
 */
export function briefingDataRows(document: DailyBriefingDocument): readonly (BriefingMarketRow | BriefingPulseRow)[] {
  return briefingDataRowsFromGroups(briefingDataGroups(document))
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
  locale = 'en-US',
  /** The poster's cell has ~190px: it keeps the headline change and drops the longer windows. */
  options: Readonly<{ compact?: boolean }> = {}
): Readonly<{ primary: string; secondary: string }> | null {
  if (row.id !== 'stablecoin' && row.id !== 'fear-greed') return null
  // Without a level there is no caption, and the normal "no value" row is the honest rendering.
  if (row.value === null) return null
  const level = formatBriefingValue(row.value, labels.noValue, locale)
  const caption = (row.id === 'stablecoin' ? labels.rowTotal : labels.rowCurrent).replace('{value}', level)
  const reason = row.changeReason ? labels.changeReasons[row.changeReason] ?? '' : ''
  if (!row.change) return Object.freeze({ primary: reason || caption, secondary: reason ? caption : '' })
  // A cell shows one comparison; the 7d/30d windows stay in the copied text, where there is room and
  // where the reader can read them as a sentence.
  const secondary = row.id === 'stablecoin' && !options.compact
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

function newsLine(item: BriefingNewsItem, options: DailyBriefingMarkdownOptions): string {
  // 中文版没有译文时标题只能是原文：复制出去也要写清，别静默印英文。
  const title = escapeMarkdown(editionNewsTitle(item, options.locale)) + (editionNewsTitleIsOriginal(item, options.locale) ? `（${options.labels.newsOriginal}）` : '')
  return `- **${title}** — ${escapeMarkdown(item.sourceName)} · ${options.formatTime(item.publishedAt)} · ${item.polarity}`
}

function macroLine(item: BriefingMacroItem, options: DailyBriefingMarkdownOptions): string {
  const title = escapeMarkdown(options.eventTitle ? options.eventTitle(item) : item.title)
  const surprise = options.labels.macro.surprise[item.surprise.direction] ?? item.surprise.direction
  // 值那一段与正文同一份拼法（`02` v2.128）：没有值就**整段不出现**（不印破折号，也不说"没拿到"），
  // 网页取到的值带同一个来源后缀——图上标的、复制出来的必须是同一句话。
  const value = briefingMacroValueLabel(
    { actual: options.labels.macro.actual, webValue: options.labels.macroWebValue },
    item
  )
  return [
    `- **${title}** — ${options.formatTime(item.scheduledAt)}`,
    ...(value === undefined ? [] : [value]),
    `${options.labels.macro.consensus} ${item.consensus ?? options.labels.macro.noConsensus}`,
    `${options.labels.macro.previous} ${item.previous ?? '—'}`,
    surprise
  ].join(' · ')
}

function dataLine(row: BriefingMarketRow | BriefingPulseRow, options: DailyBriefingMarkdownOptions): string {
  // 价格那两行读的是币安 U 本位**永续合约**，不是现货；正文卡片标了、复制文本没标，读者会把两个
  // 市场当成一个。只有 BTC/ETH 两行加：纳指走真指数或代币化永续，它有自己的代理标记。
  const perpetual = row.id === 'btc' || row.id === 'eth' ? ` · ${options.labels.perpetualContract}` : ''
  // 纳指走代币化永续的那些天，点位不是纳指自己的；正文卡片标了，复制出去也要标，否则读者把
  // QQQ 的点位当成纳指的点位用。
  // 文案本身带着括号与英文前的空格（与海报同一个键），这里不再补空格。
  const proxy = 'indexSource' in row && row.indexSource === 'proxy' ? options.labels.indexProxy : ''
  const label = `${rowLabel(row.labelKey, options.labels)}${perpetual}${proxy}`
  if (row.state === 'available' || row.state === 'stale') {
    const copy = changeLedRowCopy(row, options.labels, options.locale)
    if (copy) {
      const meta = [copy.secondary]
        .filter(Boolean).join(' · ')
      return `- ${label}: ${copy.primary}${meta ? ` (${meta})` : ''}`
    }
    // 点位与涨跌幅都走同一个读取函数（卡片也走它）：价格行把百分比放在 `value` 里、`change` 恒为
    // `null`，只读 `change` 会让复制出来的文本只剩一个百分比、连点位都没了。
    const figures = briefRowFigures(row)
    const value = figures.level === undefined
      ? formatBriefingValue(row.value, options.labels.noValue, options.locale)
      : formatBriefingValue({ number: figures.level, format: 'level' }, options.labels.noValue, options.locale)
    const change = figures.move === undefined
      ? row.change ? rowChangeText(row.change, options.labels, options.locale, row) : ''
      : formatRowMove(figures.move, options.labels.noValue)
    const reason = row.changeReason ? options.labels.changeReasons[row.changeReason] ?? '' : ''
    const suffix = [change, reason].filter(Boolean).join(' · ')
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
