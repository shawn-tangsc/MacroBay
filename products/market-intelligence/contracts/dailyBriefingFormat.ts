import type { BriefingValueFormat } from './dailyBriefing'

/** One formatting rule for the live brief and its Markdown copy, so export cannot disagree. */
export function formatBriefingValue(
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null,
  fallback: string,
  locale = 'en-US'
): string {
  if (!value) return fallback
  switch (value.format) {
    case 'score': return String(Math.round(value.number))
    case 'percent': return `${value.number > 0 ? '+' : ''}${value.number.toFixed(percentDigits(value.number))}%`
    case 'usd': return compactUsd(value.number, locale)
    case 'flow-usd': return compactUsd(value.number, locale, true)
    case 'yield': return `${value.number.toFixed(2)}%`
    case 'level': return levelText(value.number, locale)
  }
}

export function formatBriefingChange(
  change: Readonly<{ value: number; unit: 'pp' | 'percent' | 'bp' | 'usd' }> | null,
  locale = 'en-US'
): string {
  if (!change) return ''
  const sign = change.value > 0 ? '+' : ''
  switch (change.unit) {
    case 'pp': return `${sign}${change.value.toFixed(4)}pp`
    case 'percent': return `${sign}${change.value.toFixed(percentDigits(change.value))}%`
    case 'bp': return `${sign}${Math.round(change.value)}bp`
    case 'usd': return compactUsd(change.value, locale, true)
  }
}

/**
 * A price level: grouped thousands, at most two decimals and at least one.
 *
 * The precision belongs to the reading, not to the formatter. `110,432.1` and `3,927.99` follow the same
 * rule, and printing the first as `110,432.10` would claim a digit nobody measured; the minimum of one
 * decimal keeps a round level from looking like a count. No per-source precision field: a data source is
 * not responsible for how the screen rounds it.
 */
function levelText(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value)
}

function percentDigits(value: number): number {
  // Funding rates are quoted in hundredths of a basis point; two decimals would print 0.00%.
  return value !== 0 && Math.abs(value) < 0.01 ? 4 : 2
}

function compactUsd(value: number, _locale: string, signed = false): string {
  const magnitude = Math.abs(value)
  const unit = magnitude >= 1_000_000_000
    ? `${trimZero(magnitude / 1_000_000_000)}B`
    : magnitude >= 1_000_000
      ? `${trimZero(magnitude / 1_000_000)}M`
      : magnitude >= 1_000
        ? `${trimZero(magnitude / 1_000)}K`
        : String(Math.round(magnitude))
  return `${value < 0 ? '-' : signed && value > 0 ? '+' : ''}${unit} USD`
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
