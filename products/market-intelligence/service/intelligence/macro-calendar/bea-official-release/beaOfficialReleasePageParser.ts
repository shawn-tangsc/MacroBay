import type { BeaOfficialReleaseRssIdentity, BeaReleaseGroup } from './beaOfficialReleaseRssRecognizer'

export type BeaOfficialReleasePageFacts = Readonly<{ pcePercent: number; corePcePercent: number } | { gdpPercent: number }>

export const beaOfficialReleasePageParserPolicy = Object.freeze({
  titleSuffix: ' | U.S. Bureau of Economic Analysis (BEA)',
  titlePattern: /<title\b[^>]*>([\s\S]*?)<\/title>/gi,
  releaseHeadlinePattern: /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
  releaseBodyOpenPattern: /<([a-z0-9]+)\b[^>]*class="[^"]*\brelease-body\b[^"]*"[^>]*>/gi,
  decimalPattern: /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/,
  pioSentencePattern: /From the same month one year ago, the PCE price index for ([A-Z][a-z]+) (increased|decreased) (\d+(?:\.\d+)?) percent\s*\.\s*Excluding food and energy, the PCE price index (increased|decreased) (\d+(?:\.\d+)?) percent from one year ago\s*\./g,
  gdpSentencePattern: /Real gross domestic product \(GDP\) (increased|decreased) at an annual rate of (\d+(?:\.\d+)?) percent in the (first|second|third|fourth) quarter of (\d{4})(?: \([A-Z][a-z]+, [A-Z][a-z]+, and [A-Z][a-z]+\))?, according to the (?:advance|second|third) estimate released today by the U\.S\. Bureau of Economic Analysis \(BEA\)\./g,
  gdpTablePattern: /<table\b[^>]*>([\s\S]*?)<\/table>/gi,
  tableCaptionPattern: /<(?:caption|th)\b[^>]*>([\s\S]*?)<\/(?:caption|th)>/gi,
  tableRowPattern: /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi,
  tableCellPattern: /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi,
  gdpTableCaption: 'Real GDP and Related Measures'
})

export function parseBeaOfficialReleasePage(input: Readonly<{ group: BeaReleaseGroup; rss: BeaOfficialReleaseRssIdentity; body: string }>): BeaOfficialReleasePageFacts | undefined {
  if (!input.group || !input.rss || typeof input.body !== 'string' || !hasDocumentIdentity(input.body, input.rss.title)) return undefined
  const releaseBody = uniqueReleaseBody(input.body)
  if (!releaseBody) return undefined
  return input.group.kind === 'pce-core'
    ? parsePce(input.group, releaseBody)
    : parseGdp(input.group, input.rss, releaseBody)
}

function hasDocumentIdentity(html: string, title: string): boolean {
  const titles = allText(html, beaOfficialReleasePageParserPolicy.titlePattern)
  const headlines = allText(html, beaOfficialReleasePageParserPolicy.releaseHeadlinePattern).filter((value) => value !== 'News Release')
  return titles.length === 1 && titles[0] === `${title}${beaOfficialReleasePageParserPolicy.titleSuffix}` &&
    headlines.length === 1 && headlines[0] === title
}
function uniqueReleaseBody(html: string): string | undefined {
  const openings = [...html.matchAll(beaOfficialReleasePageParserPolicy.releaseBodyOpenPattern)]
  if (openings.length !== 1) return undefined
  const opening = openings[0]!
  const tag = opening[1]!
  const start = (opening.index ?? 0) + opening[0].length
  const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
  let depth = 1
  for (const token of html.slice(start).matchAll(tokenPattern)) {
    if (token[0]!.startsWith('</')) depth -= 1
    else if (!/\/\s*>$/.test(token[0]!)) depth += 1
    if (depth === 0) {
      const body = html.slice(start, start + (token.index ?? 0))
      return visibleText(body) ? body : undefined
    }
  }
  return undefined
}
function parsePce(group: Extract<BeaReleaseGroup, { kind: 'pce-core' }>, body: string): BeaOfficialReleasePageFacts | undefined {
  const matches = [...visibleText(body).matchAll(beaOfficialReleasePageParserPolicy.pioSentencePattern)]
  if (matches.length !== 1) return undefined
  const match = matches[0]!
  const [year, month] = group.periodKey.split('-')
  if (monthName(month) !== match[1] || !year || !value(match[3]) || !value(match[5])) return undefined
  return { pcePercent: signed(match[2]!, Number(match[3])), corePcePercent: signed(match[4]!, Number(match[5])) }
}
function parseGdp(group: Extract<BeaReleaseGroup, { kind: 'gdp' }>, rss: BeaOfficialReleaseRssIdentity, body: string): BeaOfficialReleasePageFacts | undefined {
  const sentence = gdpSentenceValue(group, body)
  const table = gdpTableValue(group, body)
  if (sentence === undefined && table === undefined) return undefined
  if (sentence !== undefined && table !== undefined && sentence !== table) return undefined
  const result = sentence ?? table!
  return rss.currentPercent === undefined || rss.currentPercent === result ? { gdpPercent: result } : undefined
}
function gdpSentenceValue(group: Extract<BeaReleaseGroup, { kind: 'gdp' }>, body: string): number | undefined {
  const matches = [...visibleText(body).matchAll(beaOfficialReleasePageParserPolicy.gdpSentencePattern)]
  if (matches.length !== 1) return undefined
  const match = matches[0]!
  const [year, quarter] = group.periodKey.split('-Q')
  return `${quarterName(quarter)} quarter of ${year}` === `${match[3]} quarter of ${match[4]}` && value(match[2]) ? signed(match[1]!, Number(match[2])) : undefined
}
function gdpTableValue(group: Extract<BeaReleaseGroup, { kind: 'gdp' }>, body: string): number | undefined {
  const tables = [...body.matchAll(beaOfficialReleasePageParserPolicy.gdpTablePattern)].map((match) => match[1] ?? '')
    .filter((table) => allText(table, beaOfficialReleasePageParserPolicy.tableCaptionPattern).filter((title) => title === beaOfficialReleasePageParserPolicy.gdpTableCaption || title.startsWith(`${beaOfficialReleasePageParserPolicy.gdpTableCaption} [`)).length === 1)
  if (tables.length !== 1) return undefined
  const rows = [...tables[0]!.matchAll(beaOfficialReleasePageParserPolicy.tableRowPattern)].map((match) => cells(match[1] ?? '')).filter((row) => row.length > 0)
  const headers = rows.find((row) => row.includes(estimateLabel(group.variant)))
  const realGdp = rows.filter((row) => row[0] === 'Real GDP')
  if (!headers || realGdp.length !== 1) return undefined
  const estimateIndex = headers.indexOf(estimateLabel(group.variant))
  if (estimateIndex < 0) return undefined
  const rowOffset = headers[0] === '' ? 0 : 1
  const candidate = realGdp[0]![estimateIndex + rowOffset]
  return candidate && value(candidate) ? Number(candidate) : undefined
}
function cells(row: string): string[] { return [...row.matchAll(beaOfficialReleasePageParserPolicy.tableCellPattern)].map((match) => visibleText(match[1] ?? '')) }
function estimateLabel(variant: Extract<BeaReleaseGroup, { kind: 'gdp' }>['variant']): string { return `${variant.slice(0, 1)}${variant.slice(1).toLowerCase()} Estimate` }
function allText(html: string, pattern: RegExp): string[] { return [...html.matchAll(pattern)].map((match) => visibleText(match[1] ?? '')).filter(Boolean) }
function visibleText(html: string): string { return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() }
function value(input: string | undefined): boolean { return Boolean(input && beaOfficialReleasePageParserPolicy.decimalPattern.test(input) && Number.isFinite(Number(input))) }
function signed(direction: string, amount: number): number { return direction === 'decreased' ? -amount : amount }
function monthName(month: string | undefined): string | undefined { const index = Number(month); return Number.isSafeInteger(index) && index >= 1 && index <= 12 ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][index - 1] : undefined }
function quarterName(quarter: string | undefined): string | undefined { return ({ '1': 'first', '2': 'second', '3': 'third', '4': 'fourth' } as Record<string, string>)[quarter ?? ''] }
