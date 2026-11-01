import type {
  BriefingRowChange,
  BriefingValueFormat,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import { formatReadableUsdAmount } from '../../../contracts/marketAnalysisReadableText'

/**
 * The one display spelling of a fact number, the string the editorial model must quote verbatim.
 *
 * The prompt carries raw stored values for reasoning, but prose may only repeat `display`: a
 * percentage keeps two decimals, and a USD amount is scaled to 亿/万 in Chinese and B/M/K in
 * English. Formatting lives here so the prompt and the validator cannot disagree about which
 * spellings are legal.
 */
export function formatBriefingValueDisplay(
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null,
  locale: DailyBriefingLocale
): string | null {
  if (!value) return null
  switch (value.format) {
    case 'percent': return formatPercentDisplay(value.number)
    case 'usd': return formatReadableUsdAmount(value.number, locale, false)
    case 'flow-usd': return formatReadableUsdAmount(value.number, locale, true)
    case 'yield': return `${value.number.toFixed(2)}%`
    case 'score': return String(Math.round(value.number))
    case 'level': return value.number.toFixed(2)
  }
}

export function formatBriefingChangeDisplay(
  change: BriefingRowChange | null,
  locale: DailyBriefingLocale
): string | null {
  if (!change) return null
  const sign = change.value > 0 ? '+' : ''
  switch (change.unit) {
    case 'percent': return formatPercentDisplay(change.value)
    case 'pp': return `${sign}${change.value.toFixed(2)}pp`
    case 'bp': return `${sign}${Math.round(change.value)}bp`
    case 'usd': return formatReadableUsdAmount(change.value, locale, true)
    case 'points': return `${sign}${change.value.toFixed(2)}`
  }
}

/** Percentages read with two decimals; a funding rate of 0.0036% reaches the reader as 0.00%. */
export function formatPercentDisplay(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/**
 * Every number token a display string carries, normalized the way the fact whitelist compares
 * them. Without this the validator would reject a legitimate `-6.43 亿美元` because only the raw
 * `-643200000` is a stored fact.
 */
export function briefingDisplayNumbers(display: string | null | undefined): readonly string[] {
  const tokens = new Set<string>()
  for (const token of display?.match(/[-+]?\$?\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const normalized = trimFractionZeros(token.replace(/[,$]/g, '').replace(/^\+/, ''))
    tokens.add(normalized)
    tokens.add(normalized.replace(/^-/, ''))
  }
  return [...tokens]
}

function trimFractionZeros(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}
