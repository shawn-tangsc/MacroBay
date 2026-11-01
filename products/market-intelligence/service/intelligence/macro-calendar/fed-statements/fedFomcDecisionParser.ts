import { createHash } from 'node:crypto'

import { fedFomcDecisionFixtureProvenance } from './fedFomcDecisionProvenance'

export type FedFomcVote = { for: number; against: number }

/** How a dissenting participant would have moved the range at this meeting. */
export type FedFomcDissent = { name: string; preferred: 'raise' | 'lower' | 'maintain' }

export type FedFomcDecisionEvidence = {
  eventKey: string
  decisionDate: string
  releasedAt: string
  targetRange: { lowerPercent: number; upperPercent: number; displayValue: string }
  /** Absent when the statement does not state a vote tally; never invented. */
  vote?: FedFomcVote
  /** Absent when nobody dissented, or when the sentence is not in the body. */
  dissents?: FedFomcDissent[]
}

export type FedFomcDecisionDocument = Omit<FedFomcDecisionEvidence, 'eventKey'>

export const fedFomcDecisionParserPolicy = {
  officialHostname: 'www.federalreserve.gov',
  officialStatementPath: /^\/newsevents\/pressreleases\/monetary(\d{8})[a-z]\.htm$/,
  decisionTitle: 'Federal Reserve issues FOMC statement',
  publisher: 'Board of Governors of the Federal Reserve System',
  approvalStatement: 'The Federal Open Market Committee approved the following statement for release',
  decisionStatementOpen: 'The Committee decided to ',
  // Fed explicit-final-range grammar: direction/change never supplies a missing bound.
  decisionStatementPrefixPattern: 'The Committee decided to (?:maintain the target range for the federal funds rate at |(?:raise|lower) the target range for the federal funds rate by [0-9]+/[0-9]+ percentage point to )',
  bodyColumnClass: 'col-xs-12 col-sm-8 col-md-8',
  maximumBodyBytes: 128 * 1024,
  scheduleEventKeyPattern: /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/,
  releaseTimeZoneOffsetsMinutes: { EDT: -240, EST: -300 },
  supportedFractionDenominators: [2, 4],
  months: {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
  }
} as const

export function parseFedFomcDecision(input: unknown): FedFomcDecisionEvidence | undefined {
  try {
    if (!isInput(input)) return undefined
    const document = parseFedFomcDecisionDocument({ body: input.body, officialStatementUrl: input.officialStatementUrl })
    return document && input.schedule.scheduledDate === document.decisionDate
      ? { eventKey: input.schedule.eventKey, ...document }
      : undefined
  } catch {
    return undefined
  }
}

export function parseFedFomcDecisionDocument(input: unknown): FedFomcDecisionDocument | undefined {
  try {
    if (!isDocumentInput(input)) return undefined
    const html = decodeUtf8(input.body)
    if (!html || !hasExactDecisionIdentity(html, input.officialStatementUrl)) return undefined
    const decisionDate = parseDecisionDate(html)
    const sourceDate = new URL(input.officialStatementUrl).pathname.match(fedFomcDecisionParserPolicy.officialStatementPath)?.[1]
    if (!decisionDate || decisionDate.replaceAll('-', '') !== sourceDate) return undefined
    const releasedAt = decisionDate ? parseReleaseInstant(html, decisionDate) : undefined
    const targetRange = parseTargetRange(html)
    if (!decisionDate || !releasedAt || !targetRange) return undefined
    const bodyText = decisionBody(html)
    const vote = parseVote(bodyText)
    const dissents = parseDissents(bodyText)
    return { decisionDate, releasedAt, targetRange, ...(vote ? { vote } : {}), ...(dissents ? { dissents } : {}) }
  } catch {
    return undefined
  }
}

function isInput(value: unknown): value is { body: Buffer; officialStatementUrl: string; schedule: { eventKey: string; eventFamily: 'fomc'; scheduledDate: string } } {
  return isExactRecord(value, ['body', 'officialStatementUrl', 'schedule']) && Buffer.isBuffer(value.body) &&
    value.body.byteLength > 0 && value.body.byteLength <= fedFomcDecisionParserPolicy.maximumBodyBytes &&
    value.body.byteLength === fedFomcDecisionFixtureProvenance.payloadBytes &&
    createHash('sha256').update(value.body).digest('hex') === fedFomcDecisionFixtureProvenance.sha256 &&
    value.officialStatementUrl === fedFomcDecisionFixtureProvenance.canonicalUrl && isExactRecord(value.schedule, ['eventKey', 'eventFamily', 'scheduledDate']) &&
    value.schedule.eventFamily === 'fomc' && fedFomcDecisionParserPolicy.scheduleEventKeyPattern.test(value.schedule.eventKey) &&
    value.schedule.eventKey === `US.FOMC.${value.schedule.scheduledDate}` && isDate(value.schedule.scheduledDate)
}

function isDocumentInput(value: unknown): value is { body: Buffer; officialStatementUrl: string } {
  return isExactRecord(value, ['body', 'officialStatementUrl']) && Buffer.isBuffer(value.body) &&
    value.body.byteLength > 0 && value.body.byteLength <= fedFomcDecisionParserPolicy.maximumBodyBytes &&
    isOfficialStatementUrl(value.officialStatementUrl)
}

function hasExactDecisionIdentity(html: string, officialStatementUrl: string): boolean {
  const title = escapeRegExp(fedFomcDecisionParserPolicy.decisionTitle)
  const publisher = escapeRegExp(fedFomcDecisionParserPolicy.publisher)
  const body = decisionBody(html)
  return hasOne(html, new RegExp(`<meta property="og:site_name" content="${publisher}"\\s*\\/>`, 'g')) &&
    hasOne(html, new RegExp(`<meta property="og:title" content="${title}"\\s*\\/>`, 'g')) &&
    hasOne(html, new RegExp(`<meta name="twitter:title" content="${title}"\\s*\\/>`, 'g')) &&
    hasOne(html, new RegExp(`<title>Federal Reserve Board - ${title}<\\/title>`, 'g')) &&
    hasOne(html, new RegExp(`<h3 class="title">${title}<\\/h3>`, 'g')) &&
    hasOne(body, new RegExp(escapeRegExp(fedFomcDecisionParserPolicy.approvalStatement), 'g')) &&
    hasOne(body, new RegExp(escapeRegExp(fedFomcDecisionParserPolicy.decisionStatementOpen), 'g')) &&
    hasOne(body, new RegExp(fedFomcDecisionParserPolicy.decisionStatementPrefixPattern, 'g')) &&
    hasOne(html, new RegExp(`<meta property="og:url" content="${escapeRegExp(officialStatementUrl)}"\\s*\\/>`, 'g'))
}

function parseDecisionDate(html: string): string | undefined {
  const dateText = oneCapture(html, /<p class="article__time">\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*<\/p>/g)
  const match = dateText ? /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(dateText) : undefined
  if (!match) return undefined
  const month = fedFomcDecisionParserPolicy.months[match[1] as keyof typeof fedFomcDecisionParserPolicy.months]
  const day = Number(match[2])
  const year = Number(match[3])
  const date = month && Number.isSafeInteger(day) && Number.isSafeInteger(year)
    ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : undefined
  return date && isDate(date) ? date : undefined
}

function parseReleaseInstant(html: string, decisionDate: string): string | undefined {
  const release = oneCapture(html, /<p class="releaseTime">\s*For release at (\d{1,2}):(\d{2}) (a\.m\.|p\.m\.) (EDT|EST)/g)
  if (!release) return undefined
  const [hourText, minuteText, meridiem, zone] = release.split('|')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const offset = fedFomcDecisionParserPolicy.releaseTimeZoneOffsetsMinutes[zone as keyof typeof fedFomcDecisionParserPolicy.releaseTimeZoneOffsetsMinutes]
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59 || offset === undefined) return undefined
  const localHour = hour % 12 + (meridiem === 'p.m.' ? 12 : 0)
  const timestamp = Date.parse(`${decisionDate}T00:00:00.000Z`) - offset * 60_000 + (localHour * 60 + minute) * 60_000
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

/**
 * The statement's approval sentence carries the vote tally. The separator is an en dash in the
 * published page and occasionally a hyphen in derived captures, so both are accepted.
 */
function parseVote(bodyText: string): FedFomcVote | undefined {
  const match = /approved the following statement for release by a (\d+)\s*[–—-]\s*(\d+) vote/.exec(bodyText)
  if (!match) return undefined
  const vote = { for: Number(match[1]), against: Number(match[2]) }
  return Number.isSafeInteger(vote.for) && Number.isSafeInteger(vote.against) && vote.for + vote.against > 0 ? vote : undefined
}

/** A dissent names the participants and the direction they preferred; both halves are required. */
function parseDissents(bodyText: string): FedFomcDissent[] | undefined {
  const match = /Voting against the monetary policy action were (.+?), who preferred to (raise|lower|maintain)\b/.exec(bodyText)
  if (!match) return undefined
  const preferred = match[2] as FedFomcDissent['preferred']
  const names = match[1]!.split(/,| and /).map((name) => name.trim()).filter(Boolean)
  return names.length ? names.map((name) => ({ name, preferred })) : undefined
}

function parseTargetRange(html: string): FedFomcDecisionEvidence['targetRange'] | undefined {
  const range = oneCapture(decisionBody(html), new RegExp(`${fedFomcDecisionParserPolicy.decisionStatementPrefixPattern}([0-9]+(?:-[0-9]+\\/[0-9]+)? to [0-9]+(?:-[0-9]+\\/[0-9]+)?) percent,`, 'g'))
  if (!range) return undefined
  const [lowerText, upperText] = range.split(' to ')
  const lowerPercent = parseBound(lowerText)
  const upperPercent = parseBound(upperText)
  return lowerPercent === undefined || upperPercent === undefined || lowerPercent >= upperPercent
    ? undefined
    : { lowerPercent, upperPercent, displayValue: `${range} percent` }
}

function decisionBody(html: string): string {
  const bodyColumnClass = escapeRegExp(fedFomcDecisionParserPolicy.bodyColumnClass)
  const matches = [...html.matchAll(new RegExp(`<div id="article">[\\s\\S]*?<div class="${bodyColumnClass}">([\\s\\S]*?)<\\/div>\\s*<div class="col-xs-12 col-sm-4 col-md-4">`, 'g'))]
  return matches.length === 1 ? normalizeDecisionBodyText(matches[0]![1]!) : ''
}

function normalizeDecisionBodyText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function parseBound(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(\d+)(?:-(\d+)\/(\d+))?$/.exec(value)
  if (!match) return undefined
  const whole = Number(match[1])
  if (!Number.isSafeInteger(whole)) return undefined
  if (!match[2] || !match[3]) return whole
  const numerator = Number(match[2])
  const denominator = Number(match[3])
  return Number.isSafeInteger(numerator) && fedFomcDecisionParserPolicy.supportedFractionDenominators.includes(denominator as 2 | 4) && numerator > 0 && numerator < denominator
    ? whole + numerator / denominator
    : undefined
}

function decodeUtf8(body: Buffer): string | undefined {
  const text = body.toString('utf8')
  return Buffer.from(text, 'utf8').equals(body) ? text : undefined
}

function isOfficialStatementUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === fedFomcDecisionParserPolicy.officialHostname && !url.username && !url.password && !url.port && !url.search && !url.hash && fedFomcDecisionParserPolicy.officialStatementPath.test(url.pathname)
  } catch {
    return false
  }
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
  const names = Object.getOwnPropertyNames(value)
  return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return Boolean(descriptor && 'value' in descriptor)
  })
}

function hasOne(value: string, pattern: RegExp): boolean {
  return [...value.matchAll(pattern)].length === 1
}

function oneCapture(value: string, pattern: RegExp): string | undefined {
  const matches = [...value.matchAll(pattern)]
  return matches.length === 1 ? matches[0]!.slice(1).join('|') : undefined
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
