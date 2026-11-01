import type { PolicyPathSep } from '../../../contracts/policyPath'

/**
 * Reads the policy path out of the SEP projection materials.
 *
 * Only the federal funds rate row is used. The chart's individual dots are not in the page's HTML —
 * they exist only as a rendered figure — so the median, the range and the previous quarter's median
 * are the whole of what can be read without OCR. That is enough to answer "does the committee still
 * expect one more move", which is the question the block asks.
 */
export const policyPathSepPolicy = {
  sourcePrefix: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl',
  rowLabel: 'Federal funds rate',
  previousRowLabel: 'projection',
  missingValue: '—'
} as const

export function parsePolicyPathSep(input: { body: string; sourceUrl: string }): PolicyPathSep | undefined {
  const asOf = meetingDateFromUrl(input.sourceUrl)
  if (!asOf || !input.body.includes(policyPathSepPolicy.rowLabel)) return undefined

  const rows = tableRows(input.body)
  // The header row only carries the four calendar years; the fifth column is the longer run, which
  // the page labels in a separate group row. Reading the years off the first `Variable` row found
  // gave three section labels ("Median 1", "Central Tendency 2", …) instead of years.
  const header = rows.find((cells) => cells[0] === 'Variable' && cells.slice(1).filter((cell) => /^\d{4}$/.test(cell)).length >= 4)
  if (!header) return undefined
  const calendarYears = header.slice(1).filter((cell) => /^\d{4}$/.test(cell)).slice(0, 4)
  const years = calendarYears.length === 4 ? [...calendarYears, 'Longer run'] : calendarYears
  if (years.length < 5) return undefined

  const index = rows.findIndex((cells) => cells[0]?.startsWith(policyPathSepPolicy.rowLabel))
  if (index < 0) return undefined
  const fed = rows[index]!
  const medians = fed.slice(1, 6).map(numberOrUndefined)
  if (medians.filter((value) => value !== undefined).length < 2) return undefined

  const medianPath: Record<string, number> = {}
  medians.forEach((value, position) => {
    const year = years[position]
    if (value === undefined || !year) return
    medianPath[year === 'Longer run' ? 'longerRun' : `y${year}`] = value
  })

  const currentYearPosition = years.findIndex((year) => /^\d{4}$/.test(year))
  const rangeCell = fed.slice(11, 16)[currentYearPosition]
  const range = rangeCell ? rangeFromCell(rangeCell) : undefined
  const previous = rows.slice(index + 1).find((cells) => cells[0]?.includes(policyPathSepPolicy.previousRowLabel))
  const previousMedian = previous ? numberOrUndefined(previous[1] ?? '') : undefined

  return {
    asOf,
    medianPath: medianPath as PolicyPathSep['medianPath'],
    ...(range ? { rangeCurrentYear: range } : {}),
    ...(previousMedian === undefined ? {} : { previousMedian }),
    sourceUrl: input.sourceUrl
  }
}

function meetingDateFromUrl(url: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(policyPathSepPolicy.sourcePrefix)}(\\d{8})\\.htm$`).exec(url)
  if (!match) return undefined
  const [year, month, day] = [match[1]!.slice(0, 4), match[1]!.slice(4, 6), match[1]!.slice(6, 8)]
  const date = `${year}-${month}-${day}`
  return Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) ? undefined : date
}

/** Each `<tr>` becomes its cells' text; tags, entities and non-breaking spaces are stripped. */
function tableRows(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1]!)))
    .filter((cells) => cells.length > 0)
}

function text(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function numberOrUndefined(value: string): number | undefined {
  if (!value || value === policyPathSepPolicy.missingValue) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rangeFromCell(value: string): { low: number; high: number } | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/.exec(value)
  if (!match) return undefined
  const low = Number(match[1])
  const high = Number(match[2])
  return Number.isFinite(low) && Number.isFinite(high) && low < high ? { low, high } : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
