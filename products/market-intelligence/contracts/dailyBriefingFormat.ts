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
    case 'level': return value.number.toFixed(2)
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
