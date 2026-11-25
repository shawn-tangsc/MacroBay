import { resolveCountryCode } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { correctSourceCountryCode } from '../marketCalendarSourceCountryCorrection'
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
  /**
   * 国家码：白名单映射后的 alpha-2 / `EMU`，或**认不出但形状像国家码**的原码（2–3 位大写字母）。
   * 早前只允许 `'US' | 'DE'`，于是源给的 JP/GB/CA 只能被丢掉——类型收得比事实窄，也是一种丢数据。
   */
  countryCode?: string
  /**
   * 源给的占位国家码（如 `ZZ`）。`countryCode` 为「无国家」，**但这一条必须能被数出来**——
   * 否则占位码从「丢行」变成「静默归为无国家」，仍然不可见（用户 2026-11-17）。
   */
  placeholderCountryCode?: string
  countryName?: string
  /** 可缺省：来源没给重要性就没有值（缺省 ≠ 低重要度）。 */
  importance?: 'high' | 'medium' | 'low'
  scheduledDate: string
  scheduledAt: string
  indicatorId?: string
  consensus?: ZeroXRouterDisplayValue
  providerPrevious?: ZeroXRouterDisplayValue
  providerActual?: ZeroXRouterDisplayValue
  providerImpact?: Readonly<{ label: string; code?: string }>
  /**
   * 这条发布覆盖的全部指标 key，逗号分隔（存储快照只允许基元字段，数组进不去）。
   * **与 `indicatorId` 是两个字段**：`indicatorId` 是主 measure（决定这条事件叫什么），
   * 这一份是「它还包含哪些指标」。旧来源没有这个概念，旧行这一列是 null。
   */
  measureKeys?: string
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
  /**
   * 源实际会返回的国家码（fixture 实测：US 107 / JP 105 / EU 105 / GB 104 / CA 104 次，另有 USA、GER）。
   * 早前只认四个值，其余**被静默丢掉**，于是那些行落到未映射表（`missing-country` 1869 行）——
   * 不是源没给，是我们没接住。`EU` 归 `EMU`（欧元区），不要写成 `EU`：`EU` 含非欧元国，
   * 与「欧盟 vs 欧元区」混用会让两个身份撞在一起。
   */
  countryCodes: Object.freeze({
    USA: 'US', US: 'US', GER: 'DE', DE: 'DE', JP: 'JP', EU: 'EMU', GB: 'GB', CA: 'CA'
  } as const),
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
  /**
   * **认不出的国家码不许丢**（用户 2026-11-17）：看起来像国家码（2–3 位大写字母）就原样带下来，
   * 先保留原码进标准表——能显示、能筛选，国家名暂时就是原码；等映射补上再归一。
   * 丢掉一个码等于把那一整行变成「未知国家」，而丢掉是静默的：1869 行就是这么没的。
   */
  const rawCountryCode = typeof row.countryCode === 'string' ? row.countryCode.trim().toUpperCase() : ''
  // 三态谓词：`code` 落地、`none` 当作没有国家（行保留）、`invalid` 交给上层判非法，不在这里静默丢。
  const verdict = resolveCountryCode(rawCountryCode)
  const mappedCountryCode = verdict.state !== 'code' ? undefined
    : Object.hasOwn(policy.countryCodes, verdict.code)
      ? policy.countryCodes[verdict.code as keyof typeof policy.countryCodes] : verdict.code
  /**
   * **源自相矛盾时以名为准**（2026-11-25）：南非回购利率那两条源给 `SA` + `南非`，码是沙特的、
   * 名是南非的——按码落库会让它们以沙特身份进库。只在 0xrouter 作用域内改（见
   * `marketCalendarSourceCountryCorrection`）：沙特阿美那行 `SA` + `沙特` 仍然留 `SA`。
   */
  const countryCode = mappedCountryCode === undefined ? undefined : correctSourceCountryCode({
    providerId: '0xrouter', countryCode: mappedCountryCode, ...(countryName === undefined ? {} : { countryName })
  })
  // Candidate row identity only: never use this unverified key for revision chains or locale merge.
  const sourceEventId = JSON.stringify([calendarId, row.id])
  return {
    providerId: '0xrouter', descriptorId, kind, locale, sourceEventId,
    marketFactKey: JSON.stringify(['0xrouter', descriptorId, locale, sourceEventId]),
    identityState: 'unverified', localeMerge: 'disabled', officialLink: 'disabled',
    displayName, importance: policy.importance[row.star as keyof typeof policy.importance],
    ...(countryCode ? { countryCode } : {}),
    ...(verdict.state === 'none' && verdict.reason === 'placeholder' ? { placeholderCountryCode: rawCountryCode } : {}),
    ...(countryName ? { countryName } : {}),
    scheduledAt, scheduledDate: scheduledAt.slice(0, 10)
  }
}
