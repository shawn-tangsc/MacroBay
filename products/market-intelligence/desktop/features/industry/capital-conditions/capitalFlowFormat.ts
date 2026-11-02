/**
 * Flow amounts are read on one scale: USD millions, one decimal, ASCII minus.
 *
 * The card's stock tables keep their own ladder (a total supply is legitimately `$254.9B`);
 * this file is only for flow values — the chart's bar-top labels, its hover tooltip and the
 * daily table. Those three must be the same string for the same value, which is why they share
 * this one function instead of each formatting its own.
 */

/** Only millions: `+$402.6M`, `-$176.2M`, `+$1250M` (an integer never keeps a `.0`). */
export function formatFlowUsd(value: number, options: { signed?: boolean } = {}): string {
  const signed = options.signed ?? true
  if (!Number.isFinite(value) || Math.abs(value) > 999_999_999_999_999) return ''
  const normalized = Object.is(value, -0) ? 0 : value
  if (normalized === 0) return '$0'
  const sign = signed ? (normalized > 0 ? '+' : '-') : normalized < 0 ? '-' : ''
  const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, useGrouping: false })
    .format(Math.abs(normalized) / 1_000_000)
  return `${sign}$${amount}M`
}

/**
 * The number a screen reader hears. `+$402.6M` is read as `4.026 亿美元`, so the conversion
 * happens here — once, at the point where the accessible name is built — and never in a
 * visible string. Chinese uses 亿 (10^8), English says millions.
 */
export function formatFlowAccessibleNumber(value: number, locale: 'zh-CN' | 'en-US'): string {
  if (!Number.isFinite(value)) return ''
  const normalized = Object.is(value, -0) ? 0 : value
  const absolute = Math.abs(normalized)
  const divisor = locale === 'zh-CN' ? 100_000_000 : 1_000_000
  const fractionDigits = locale === 'zh-CN' ? 3 : 1
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: fractionDigits, useGrouping: false })
    .format(absolute / divisor)
}
