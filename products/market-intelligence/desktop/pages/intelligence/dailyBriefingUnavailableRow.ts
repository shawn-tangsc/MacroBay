import type { DailyBriefingText } from './dailyBriefingText'

/** The clock part of a formatted instant; absent when the formatter produced no time. */
export function formattedClock(value: string): string | undefined {
  return /\b(\d{2}:\d{2})\b/.exec(value)?.[1]
}

/**
 * One unavailable data row's sentence, ETF rows included.
 *
 * The ETF cutoff belongs to the edition: changing the setting later must not rewrite yesterday's
 * sentence. Without a readable cutoff the sentence prints no time at all instead of inventing one.
 */
export function unavailableRowCopy(input: Readonly<{
  text: DailyBriefingText
  label: string
  rowId: string
  reason?: string
  cutoff: string | undefined
}>): Readonly<{ template: 'row-unavailable' | 'capital-gate' | 'etf-no-history'; title: string; advice: string }> {
  const { text, label, cutoff } = input
  const etf = input.rowId === 'etf-btc' || input.rowId === 'etf-eth'
  if (!etf) {
    return {
      template: 'row-unavailable',
      title: text.limits.row.unavailable.replace('{row}', label),
      advice: input.reason === 'not-collected' ? text.limits.advice.waitCollection : text.limits.advice.checkSource
    }
  }
  if (input.reason === 'capital-gate') {
    return {
      template: 'capital-gate',
      title: text.limits.row.capitalGate.replace('{row}', label),
      advice: text.limits.advice.restoreCapital
    }
  }
  if (!cutoff) {
    return {
      template: 'etf-no-history',
      title: text.limits.row.etfNoHistoryNoTime.replace('{row}', label),
      advice: text.limits.advice.etfAfterOpenNoTime
    }
  }
  return {
    template: 'etf-no-history',
    title: text.limits.row.etfNoHistory.replace('{row}', label).replace('{time}', cutoff),
    advice: text.limits.advice.etfAfterOpen.replace('{time}', cutoff)
  }
}
