// Internal parser output only. These drafts do not establish stable event identity.
export type ZeroXRouterCalendarLocale = 'zh' | 'en'
export type ZeroXRouterCalendarDescriptor =
  | 'macro-calendar-0xrouter-economic-data'
  | 'macro-calendar-0xrouter-financial-events'
  | 'macro-calendar-0xrouter-central-bank-activities'
export type ZeroXRouterCalendarKind = 'economic-indicator' | 'financial-event' | 'central-bank-activity'
export type ZeroXRouterDisplayValue = Readonly<{ displayValue: string }>
export type ZeroXRouterCalendarDraft = Readonly<{
  providerId: '0xrouter'
  descriptorId: ZeroXRouterCalendarDescriptor
  kind: ZeroXRouterCalendarKind
  locale: ZeroXRouterCalendarLocale
  sourceEventId: string
  marketFactKey: string
  identityState: 'unverified'
  localeMerge: 'disabled'
  officialLink: 'disabled'
  displayName: string
  countryCode?: 'US' | 'DE'
  countryName?: string
  importance: 'high' | 'medium' | 'low'
  scheduledDate: string
  scheduledAt: string
  indicatorId?: string
  consensus?: ZeroXRouterDisplayValue
  providerPrevious?: ZeroXRouterDisplayValue
  providerActual?: ZeroXRouterDisplayValue
  providerImpact?: Readonly<{ label: string; code?: string }>
}>
export type ZeroXRouterCalendarRowFailure = 'invalid-identity' | 'invalid-date' | 'invalid-row'
export type ZeroXRouterCalendarParseResult =
  | Readonly<{ state: 'succeeded'; drafts: readonly ZeroXRouterCalendarDraft[]; diagnostics: Readonly<{
    inputRows: number
    skippedRows: number
    reasons: Readonly<Record<ZeroXRouterCalendarRowFailure, number>>
  }> }>
  | Readonly<{ state: 'unavailable'; failureCode: 'invalid-payload' }>

// MC2 parser-owned limits, changed through product acceptance. Over-limit payloads fail
// closed; there is no truncation. Covered by each endpoint's boundary tests.
export const zeroXRouterCalendarParserPolicy = Object.freeze({
  maximumRows: 1000,
  maximumTextCharacters: 512,
  maximumTextBytes: 1024,
  maximumIdentityCharacters: 128,
  maximumTimestamp: 253402300799999,
  controlCharacters: /[\u0000-\u001f\u007f-\u009f]/u,
  identityPattern: /^[A-Za-z0-9_-]+$/,
  placeholders: Object.freeze(['', '-', '--', '—', 'n/a', 'null']),
  countryCodes: Object.freeze({ USA: 'US', US: 'US', GER: 'DE', DE: 'DE' } as const),
  importance: Object.freeze({ 1: 'low', 2: 'medium', 3: 'high' } as const)
})

export function calendarRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

export function calendarText(value: unknown): string | undefined {
  const policy = zeroXRouterCalendarParserPolicy
  if (typeof value !== 'string' || value.length > policy.maximumTextCharacters ||
    new TextEncoder().encode(value).length > policy.maximumTextBytes || policy.controlCharacters.test(value)) return undefined
  const text = value.trim().replace(/\s+/gu, ' ')
  return text || undefined
}

export function calendarIdentity(value: unknown): string | undefined {
  const text = calendarText(value)
  const policy = zeroXRouterCalendarParserPolicy
  return text && text.length <= policy.maximumIdentityCharacters && policy.identityPattern.test(text) &&
    !text.startsWith('redacted-') ? text : undefined
}

function scheduledInstant(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 ||
    value > zeroXRouterCalendarParserPolicy.maximumTimestamp) return undefined
  return new Date(value).toISOString()
}

function hasCalendarIdentity(row: Record<string, unknown>): boolean {
  return Boolean(calendarIdentity(row.calendarId)) && typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0
}

function calendarScheduledAt(row: Record<string, unknown>): string | undefined {
  return scheduledInstant(row.pubTimestamp) ?? scheduledInstant(row.pubTime)
}

export function parseCalendarEnvelope(
  input: unknown,
  locale: ZeroXRouterCalendarLocale,
  parseRow: (row: Record<string, unknown>) => ZeroXRouterCalendarDraft | undefined
): ZeroXRouterCalendarParseResult {
  const envelope = calendarRecord(input)
  const unavailable = { state: 'unavailable', failureCode: 'invalid-payload' } as const
  if ((locale !== 'zh' && locale !== 'en') || envelope?.code !== 200 || typeof envelope.msg !== 'string' ||
    !Array.isArray(envelope.data) || envelope.data.length > zeroXRouterCalendarParserPolicy.maximumRows) return unavailable
  const drafts: ZeroXRouterCalendarDraft[] = []
  const identities = new Set<string>()
  // One reason per skipped row, in identity/date/remaining-fields order. No raw diagnostics.
  const diagnostics = { inputRows: envelope.data.length, skippedRows: 0,
    reasons: { 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 } }
  for (const item of envelope.data) {
    const row = calendarRecord(item)
    const reason: ZeroXRouterCalendarRowFailure | undefined = !row ? 'invalid-row'
      : !hasCalendarIdentity(row) ? 'invalid-identity' : !calendarScheduledAt(row) ? 'invalid-date' : undefined
    const draft = !reason && row ? parseRow(row) : undefined
    if (!draft) {
      diagnostics.skippedRows += 1
      diagnostics.reasons[reason ?? 'invalid-row'] += 1
      continue
    }
    if (identities.has(draft.marketFactKey)) return unavailable
    identities.add(draft.marketFactKey)
    drafts.push(draft)
  }
  return { state: 'succeeded', drafts, diagnostics }
}

export function calendarEventDraft(
  row: Record<string, unknown>, locale: ZeroXRouterCalendarLocale,
  descriptorId: ZeroXRouterCalendarDescriptor, kind: ZeroXRouterCalendarKind
): ZeroXRouterCalendarDraft | undefined {
  const calendarId = calendarIdentity(row.calendarId)
  const displayName = calendarText(row.calendarName)
  const policy = zeroXRouterCalendarParserPolicy
  const scheduledAt = calendarScheduledAt(row)
  if (!calendarId || !displayName || !hasCalendarIdentity(row) || !scheduledAt ||
    row.locale !== locale || typeof row.star !== 'number' || !Object.hasOwn(policy.importance, row.star)) return undefined
  const countryName = row.countryName == null ? undefined : calendarText(row.countryName)
  if (row.countryName != null && !countryName) return undefined
  const countryCode = typeof row.countryCode === 'string' && Object.hasOwn(policy.countryCodes, row.countryCode)
    ? policy.countryCodes[row.countryCode as keyof typeof policy.countryCodes] : undefined
  // Candidate row identity only: never use this unverified key for revision chains or locale merge.
  const sourceEventId = JSON.stringify([calendarId, row.id])
  return {
    providerId: '0xrouter', descriptorId, kind, locale, sourceEventId,
    marketFactKey: JSON.stringify(['0xrouter', descriptorId, locale, sourceEventId]),
    identityState: 'unverified', localeMerge: 'disabled', officialLink: 'disabled',
    displayName, importance: policy.importance[row.star as keyof typeof policy.importance],
    ...(countryCode ? { countryCode } : {}), ...(countryName ? { countryName } : {}),
    scheduledAt, scheduledDate: scheduledAt.slice(0, 10)
  }
}
