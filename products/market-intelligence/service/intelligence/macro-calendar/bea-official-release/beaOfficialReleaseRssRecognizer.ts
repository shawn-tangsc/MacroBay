export type BeaReleaseGroup =
  | Readonly<{ kind: 'pce-core'; releaseGroupKey: `US.BEA.PCE.${string}`; periodKey: `${number}-${string}`; scheduledDate: string; scheduledAt?: string; eventKeys: readonly [`US.PCE.${string}`, `US.CORE_PCE.${string}`] }>
  | Readonly<{ kind: 'gdp'; releaseGroupKey: `US.BEA.GDP.${string}.${'ADVANCE' | 'SECOND' | 'THIRD'}`; periodKey: `${number}-Q${1 | 2 | 3 | 4}`; variant: 'ADVANCE' | 'SECOND' | 'THIRD'; scheduledDate: string; scheduledAt?: string; eventKeys: readonly [`US.GDP.${string}`] }>

export type BeaOfficialReleaseRssIdentity = Readonly<{
  title: string
  officialPageUrl: string
  publishedAt: string
  currentPercent?: number
  previousPercent?: number
}>

export const beaOfficialReleaseRssPolicy = Object.freeze({
  itemPattern: /<item\b[^>]*>([\s\S]*?)<\/item>/gi,
  officialPageUrlPattern: /^https:\/\/www\.bea\.gov\/news\/\d{4}\/[a-z0-9-]+$/,
  schemeLessPageUrlPattern: /^www\.bea\.gov\/news\/\d{4}\/[a-z0-9-]+$/,
  pioTitlePattern: /^Personal Income and Outlays, ([A-Z][a-z]+) (\d{4})$/,
  gdpTitles: {
    ADVANCE: /^GDP \(Advance Estimate\), (\d)(?:st|nd|rd|th) Quarter (\d{4})(?: and Year \d{4})?$/,
    SECOND: /^GDP \(Second Estimate\)(?: and Corporate Profits)?, (\d)(?:st|nd|rd|th) Quarter (\d{4})$/,
    THIRD: /^GDP \(Third Estimate\)(?:, Industries, Corporate Profits, State GDP, and State Personal Income)?(?:; State PCE, \d{4})?, (\d)(?:st|nd|rd|th) Quarter (\d{4})$/
  },
  tagNames: ['title', 'link', 'guid', 'pubDate'] as const,
  decimalPattern: /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/
})

export function recognizeBeaOfficialReleaseRss(input: Readonly<{ group: BeaReleaseGroup; body: string }>): BeaOfficialReleaseRssIdentity | undefined {
  if (!isGroup(input.group) || typeof input.body !== 'string') return undefined
  const matches = [...input.body.matchAll(beaOfficialReleaseRssPolicy.itemPattern)]
    .map((match) => recognizeItem(input.group, match[1] ?? ''))
    .filter((item): item is BeaOfficialReleaseRssIdentity => item !== undefined)
  return matches.length === 1 ? Object.freeze(matches[0]!) : undefined
}

function recognizeItem(group: BeaReleaseGroup, item: string): BeaOfficialReleaseRssIdentity | undefined {
  const required = Object.fromEntries(beaOfficialReleaseRssPolicy.tagNames.map((name) => [name, onlyTag(item, name)])) as Record<string, string | undefined>
  if (!required.title || !required.link || !required.guid || !required.pubDate || required.link !== required.guid) return undefined
  const officialPageUrl = canonicalPageUrl(required.link)
  const publishedAt = canonicalPublishedAt(required.pubDate)
  if (!officialPageUrl || !publishedAt || !matchesTitle(group, required.title)) return undefined
  if (group.kind === 'pce-core') return { title: required.title, officialPageUrl, publishedAt }
  const main = gdpMain(item)
  if (!main) return undefined
  const current = gdpFact(main, 'current')
  if (!current || normalizeGdpPeriod(current.infoDate) !== group.periodKey) return undefined
  const vintage = optionalTag(item, 'vintage')
  if ((vintage === undefined && group.variant !== 'ADVANCE') || (vintage !== undefined && vintageVariant(vintage) !== group.variant)) return undefined
  const previous = gdpFact(main, 'previous')
  const expectedPrevious = previousPeriod(group.periodKey)
  return {
    title: required.title, officialPageUrl, publishedAt, currentPercent: current.percent,
    ...(previous && expectedPrevious === normalizeGdpPeriod(previous.infoDate) ? { previousPercent: previous.percent } : {})
  }
}

function gdpMain(input: string): string | undefined {
  const data = onlyTag(input, 'data')
  return data ? onlyTag(data, 'main') : undefined
}

function matchesTitle(group: BeaReleaseGroup, title: string): boolean {
  if (group.kind === 'pce-core') {
    const match = beaOfficialReleaseRssPolicy.pioTitlePattern.exec(title)
    return Boolean(match && `${match[2]}-${monthNumber(match[1]!)}` === group.periodKey)
  }
  const match = beaOfficialReleaseRssPolicy.gdpTitles[group.variant].exec(title)
  return Boolean(match && `${match[2]}-Q${match[1]}` === group.periodKey)
}

function onlyTag(input: string, name: string): string | undefined {
  const values = allTags(input, name)
  return values.length === 1 ? values[0] : undefined
}
function optionalTag(input: string, name: string): string | undefined {
  const values = allTags(input, name)
  return values.length <= 1 ? values[0] : undefined
}
function allTags(input: string, name: string): string[] {
  return [...input.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi'))]
    .map((match) => decode(match[1] ?? '')).filter((value) => value.length > 0)
}
function decode(value: string): string { return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&amp;/g, '&').trim() }
function canonicalPageUrl(value: string): string | undefined {
  const url = beaOfficialReleaseRssPolicy.schemeLessPageUrlPattern.test(value) ? `https://${value}` : value
  return beaOfficialReleaseRssPolicy.officialPageUrlPattern.test(url) ? url : undefined
}
function canonicalPublishedAt(value: string): string | undefined {
  if (!/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} (?:EDT|EST)$/.test(value)) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined
}
function gdpFact(input: string, kind: 'current' | 'previous'): { infoDate: string; percent: number } | undefined {
  const body = onlyTag(input, kind)
  if (!body) return undefined
  const infoDate = onlyTag(body, 'infoDate')
  const value = onlyTag(body, 'percentChange')
  if (!infoDate || !value || !beaOfficialReleaseRssPolicy.decimalPattern.test(value)) return undefined
  const percent = Number(value)
  return Number.isFinite(percent) ? { infoDate, percent } : undefined
}
function normalizeGdpPeriod(value: string): string | undefined {
  const match = /^Q([1-4])\s+(\d{4})$/.exec(value)
  return match ? `${match[2]}-Q${match[1]}` : undefined
}
function vintageVariant(value: string): 'ADVANCE' | 'SECOND' | 'THIRD' | undefined {
  const normalized = value.trim().toLowerCase()
  return normalized === '1st' || normalized === 'advance' ? 'ADVANCE' : normalized === '2nd' || normalized === 'second' ? 'SECOND' : normalized === '3rd' || normalized === 'third' ? 'THIRD' : undefined
}
function monthNumber(name: string): string | undefined {
  const index = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(name)
  return index >= 0 ? String(index + 1).padStart(2, '0') : undefined
}
function previousPeriod(period: string): string | undefined {
  const match = /^(\d{4})-Q([1-4])$/.exec(period)
  if (!match) return undefined
  const year = Number(match[1]); const quarter = Number(match[2])
  return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`
}
function isGroup(value: BeaReleaseGroup): boolean { return Boolean(value && typeof value.releaseGroupKey === 'string' && typeof value.periodKey === 'string') }
