import type { BriefingMarketRow, BriefingPulseRow } from '../../../contracts/dailyBriefing'
import { formatRowChange } from '../../../contracts/dailyBriefingMarkdown'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * How a data row is labelled and dressed, shared by the card and the data-area component.
 *
 * These used to live inside the card. Splitting the data area out meant either moving them or writing
 * a second copy — and a second copy is how the screenshot and the copied text start disagreeing about
 * a row. One module, two readers.
 */

export function toneFor(row: BriefingMarketRow | BriefingPulseRow): 'positive' | 'negative' | 'neutral' {
  if (row.id === 'fear-greed') return 'neutral'
  const value = row.change?.value ?? row.value?.number ?? 0
  return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
}

export function keyMeta(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText, locale: 'zh-CN' | 'en-US', formatTime: (value: string, precision?: 'minute' | 'second') => string): string {
  // The qualifier names the baseline: a session close is never described as a day move.
  const change = row.change
    ? `${text.changeWindows[row.change.window] ?? row.change.window} ${formatRowChange(row.change, text, locale)}`.trim()
    : ''
  if (row.id === 'etf-btc' || row.id === 'etf-eth') {
    const flow = (row.value?.number ?? 0) >= 0 ? text.flow.in : text.flow.out
    return `${flow}${row.observedAt ? ` · ${row.observedAt.slice(0, 10)}` : ''}`
  }
  return change || (row.observedAt ? formatTime(row.observedAt, 'minute') : '')
}


export function rowLabel(text: DailyBriefingText, labelKey: string): string {
  return text.rows[labelKey.split('.').pop() as keyof DailyBriefingText['rows']] ?? labelKey
}


type StaleBasis = NonNullable<BriefingMarketRow['valueBasis']>

/**
 * The label a fallback reading wears: which source it came from and over what window.
 *
 * The image and the copied text both carry it now — the image no longer drops stale rows, because an
 * export that hides a row the text still has makes two answers to one question.
 */
export function fallbackLabel(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText): React.ReactNode {
  if (row.state !== 'stale') return null
  const basis: StaleBasis | undefined = 'valueBasis' in row ? row.valueBasis : undefined
  // Only say something when the number is not the thing its name promises. A 24-hour move computed
  // from a curve or from the daily series is still a 24-hour move, and the timestamp under the row
  // already says which instant it is — repeating "about 24 hours ago (from the curve)" tells the
  // reader how we computed it, which is ours to know, not theirs to read.
  const spoken: Partial<Record<StaleBasis, string>> = {
    'last-close': text.staleBasis.lastClose,
    'series-level': text.staleBasis.seriesLevel,
    published: text.staleBasis.published
  }
  const label = basis === undefined ? undefined : spoken[basis]
  if (!label) return null
  return <em className="mi-brief-poster__stale" data-basis={basis}>{label}</em>
}

/** The reader-facing name of a policy outcome ("Hike 25bp"), never the raw code. */
export function policyOutcomeLabel(outcome: string, text: DailyBriefingText): string {
  return text.policyOutcomes[outcome as keyof DailyBriefingText['policyOutcomes']] ?? outcome
}
