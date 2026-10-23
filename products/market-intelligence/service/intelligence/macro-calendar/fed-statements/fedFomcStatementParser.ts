import { officialMacroCalendarFixtureProvenance } from '../fixtures/officialMacroCalendarProvenance'
import { isFixedMacroCalendarDescriptor, type MacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'

export type FedFomcStatementDraft = {
  statementId: string
  releasedAt: string
  officialStatementUrl: string
  providerId: MacroCalendarOfficialSourceDescriptor['providerId']
  descriptorId: MacroCalendarOfficialSourceDescriptor['descriptorId']
  parserVersion: string
}

export type FedFomcStatementParserInput = {
  body: string
  descriptor: MacroCalendarOfficialSourceDescriptor
}

export const fedFomcStatementParserPolicy = {
  descriptorId: 'macro-calendar-fed-statement',
  exactTitle: 'Federal Reserve issues FOMC statement',
  parserVersion: 'fed-fomc-statement-v1',
  statementIdPrefix: 'fed-fomc-statement',
  forbiddenRawLinkDelimiters: ['?', '#'],
  publicationDatePattern: /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
} as const

export function parseFedFomcStatements(input: FedFomcStatementParserInput): FedFomcStatementDraft[] {
  if (!hasVerifiedStatementFixture(input)) return []
  const links = new Set<string>()
  const instants = new Set<string>()
  const drafts: FedFomcStatementDraft[] = []
  for (const item of input.body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const title = element(item[1]!, 'title')
    if (title !== fedFomcStatementParserPolicy.exactTitle) continue
    const officialStatementUrl = parseOfficialLink(element(item[1]!, 'link'))
    const releasedAt = parsePublicationDate(element(item[1]!, 'pubDate'))
    if (!officialStatementUrl || !releasedAt || links.has(officialStatementUrl) || instants.has(releasedAt)) return []
    links.add(officialStatementUrl)
    instants.add(releasedAt)
    drafts.push({
      statementId: `${fedFomcStatementParserPolicy.statementIdPrefix}:${releasedAt}:${officialStatementUrl}`,
      releasedAt, officialStatementUrl, providerId: input.descriptor.providerId, descriptorId: input.descriptor.descriptorId,
      parserVersion: fedFomcStatementParserPolicy.parserVersion
    })
  }
  return drafts
}

function hasVerifiedStatementFixture(input: FedFomcStatementParserInput): boolean {
  const provenance = officialMacroCalendarFixtureProvenance.find((item) => item.descriptorId === fedFomcStatementParserPolicy.descriptorId)
  return input.descriptor.descriptorId === fedFomcStatementParserPolicy.descriptorId &&
    isFixedMacroCalendarDescriptor(input.descriptor) && provenance?.status === 200 &&
    provenance.canonicalUrl === input.descriptor.sourceUrl && Boolean(provenance.fixtureFile) && Boolean(input.body.trim())
}

function element(item: string, name: string): string | undefined {
  const match = item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))
  return match ? text(match[1]!) : undefined
}

function text(value: string): string {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&amp;/g, '&').trim()
}

function parseOfficialLink(value: string | undefined): string | undefined {
  if (!value || fedFomcStatementParserPolicy.forbiddenRawLinkDelimiters.some((delimiter) => value.includes(delimiter))) return undefined
  try {
    const link = new URL(value)
    return link.protocol === 'https:' && link.hostname === 'www.federalreserve.gov' &&
      !link.username && !link.password && !link.port && !link.search && !link.hash ? link.toString() : undefined
  } catch {
    return undefined
  }
}

function parsePublicationDate(value: string | undefined): string | undefined {
  if (!value || !fedFomcStatementParserPolicy.publicationDatePattern.test(value)) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === value ? new Date(timestamp).toISOString() : undefined
}
