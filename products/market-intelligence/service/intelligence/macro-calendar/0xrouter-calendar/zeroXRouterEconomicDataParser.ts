import {
  calendarEventDraft, calendarIdentity, calendarText, parseCalendarEnvelope, zeroXRouterCalendarParserPolicy,
  type ZeroXRouterCalendarLocale, type ZeroXRouterCalendarParseResult, type ZeroXRouterDisplayValue
} from './zeroXRouterCalendarContracts'

// No unit or period has passed evidence admission. Values remain display-only,
// including ranges and zero; no numeric comparison or surprise is performed here.
export const zeroXRouterEconomicValuePolicy = Object.freeze({
  consensusField: 'estimateValue', correctedPreviousField: 'fixPreValue',
  previousField: 'preValue', actualField: 'pubValue'
})

function displayValue(value: unknown): ZeroXRouterDisplayValue | undefined | false {
  if (value == null) return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? { displayValue: String(value) } : false
  }
  if (typeof value !== 'string') return false
  const bounds = zeroXRouterCalendarParserPolicy
  if (value.length > bounds.maximumTextCharacters || new TextEncoder().encode(value).length > bounds.maximumTextBytes ||
    bounds.controlCharacters.test(value)) return false
  if (zeroXRouterCalendarParserPolicy.placeholders.includes(value.trim().toLowerCase())) return undefined
  const text = calendarText(value)
  return text ? { displayValue: text } : false
}

export function parseZeroXRouterEconomicData(input: unknown, locale: ZeroXRouterCalendarLocale): ZeroXRouterCalendarParseResult {
  return parseCalendarEnvelope(input, locale, (row) => {
    const base = calendarEventDraft(row, locale, 'macro-calendar-0xrouter-economic-data', 'economic-indicator')
    if (!base) return undefined
    const policy = zeroXRouterEconomicValuePolicy
    const consensus = displayValue(row[policy.consensusField])
    const correctedPrevious = displayValue(row[policy.correctedPreviousField])
    const previous = displayValue(row[policy.previousField])
    const providerActual = displayValue(row[policy.actualField])
    if (consensus === false || correctedPrevious === false || previous === false || providerActual === false) return undefined
    const providerPrevious = correctedPrevious ?? previous
    const indicatorId = row.indicatorsId == null ? undefined : calendarIdentity(row.indicatorsId)
    if (row.indicatorsId != null && !indicatorId) return undefined
    const label = row.dataEffect == null || row.dataEffect === '' ? undefined : calendarText(row.dataEffect)
    const code = row.dataEffectCode == null || row.dataEffectCode === '' ? undefined : calendarText(row.dataEffectCode)
    if ((row.dataEffect && !label) || (row.dataEffectCode && !code)) return undefined
    return {
      ...base, ...(indicatorId ? { indicatorId } : {}), ...(consensus ? { consensus } : {}),
      ...(providerPrevious ? { providerPrevious } : {}), ...(providerActual ? { providerActual } : {}),
      ...(label ? { providerImpact: { label, ...(code ? { code } : {}) } } : {})
    }
  })
}
