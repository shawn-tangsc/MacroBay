type BlsObservation = { year?: string; period?: string; value?: string }
type BlsSeries = { seriesID?: string; data?: BlsObservation[] }
type BlsPayload = { status?: string; Results?: { series?: BlsSeries[] } }

export type BlsObservedValueDraft = {
  metric: 'cpi-12-month-percent' | 'core-cpi-12-month-percent' | 'nonfarm-payrolls-monthly-change-thousands' | 'unemployment-rate-percent' | 'average-hourly-earnings-monthly-percent-change'
  observedPeriod: string
  value: number
  unit: 'percent' | 'thousands'
  seriesId: string
  supportingObservations?: Readonly<{ seriesId: string; observedPeriod: string; value: number }[]>
}

export type BlsCalendarFamilyValuesResult =
  | Readonly<{
    state: 'available'
    family: 'cpi'
    period: `${number}-M${string}`
    values: Readonly<{
      cpi: Readonly<{ actual: number; calendarPrevious: number }>
      coreCpi: Readonly<{ actual: number; calendarPrevious: number }>
    }>
  }>
  | Readonly<{
    state: 'available'
    family: 'employment'
    period: `${number}-M${string}`
    values: Readonly<{
      nonfarm: Readonly<{ actual: number; calendarPrevious: number }>
      unemployment: Readonly<{ actual: number; calendarPrevious: number }>
      averageHourlyEarnings: Readonly<{ actual: number; calendarPrevious: number }>
    }>
  }>
  | Readonly<{ state: 'unavailable' }>

export const blsObservedValuePolicy = {
  series: {
    cpi: 'CUUR0000SA0', coreCpi: 'CUUR0000SA0L1E', payrolls: 'CES0000000001', unemployment: 'LNS14000000',
    averageHourlyEarnings: 'CES0500000003', privatePayrolls: 'CES0500000001'
  },
  monthPattern: /^\d{4}-M(?:0[1-9]|1[0-2])$/,
  canonicalDecimalPattern: /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/,
  officialUnavailableMarkers: ['-'] as const,
  nonFiniteNumberSemantics: 'omit-unrepresentable-observation',
  duplicateResponseSemantics: 'reject-affected-series',
  malformedObservationSemantics: 'reject-affected-series',
  primaryLatestPeriodSeries: ['CUUR0000SA0', 'CUUR0000SA0L1E', 'CES0000000001', 'LNS14000000', 'CES0500000003'] as const,
  completeSnapshotRequirements: {
    candidateAndTwelveMonthsEarlier: ['CUUR0000SA0', 'CUUR0000SA0L1E'],
    candidateAndPreviousMonth: ['CES0000000001', 'CES0500000003'],
    candidateOnly: ['LNS14000000'],
    nonzeroDenominator: {
      twelveMonthsEarlier: ['CUUR0000SA0', 'CUUR0000SA0L1E'],
      previousMonth: ['CES0500000003']
    },
    derivedMetricSemantics: 'all-five-must-be-finite'
  },
  calendarFamilyRequirements: {
    successfulStatus: 'REQUEST_SUCCEEDED',
    cpi: {
      series: ['CUUR0000SA0', 'CUUR0000SA0L1E'],
      periodOffsets: [0, -1, -12, -13]
    },
    employment: {
      series: ['CES0000000001', 'LNS14000000', 'CES0500000003'],
      periodOffsets: [0, -1, -2]
    }
  }
} as const

export function parseBlsObservedValues(payload: unknown): BlsObservedValueDraft[] {
  if (!isBlsPayload(payload)) return []
  if (!payload.Results.series.every(isBlsSeries)) return []
  const series = new Map<string, Map<string, number>>()
  const rejectedSeries = new Set<string>()
  for (const item of payload.Results.series) {
    if (!item.seriesID || !Object.values(blsObservedValuePolicy.series).includes(item.seriesID as never)) continue
    if (series.has(item.seriesID)) { rejectedSeries.add(item.seriesID); continue }
    const parsed = observations(item.data)
    if (!parsed) { rejectedSeries.add(item.seriesID); continue }
    series.set(item.seriesID, parsed)
  }
  for (const seriesId of rejectedSeries) series.delete(seriesId)
  const latest = latestPeriod(series)
  if (!latest) return []
  const previousMonth = shift(latest, -1)
  const lastYear = shift(latest, -12)
  const result: BlsObservedValueDraft[] = []
  const cpi = ratio(series, blsObservedValuePolicy.series.cpi, latest, lastYear)
  const core = ratio(series, blsObservedValuePolicy.series.coreCpi, latest, lastYear)
  const payrolls = difference(series, blsObservedValuePolicy.series.payrolls, latest, previousMonth)
  const unemployment = value(series, blsObservedValuePolicy.series.unemployment, latest)
  const wages = ratio(series, blsObservedValuePolicy.series.averageHourlyEarnings, latest, previousMonth)
  if (cpi === undefined || core === undefined || payrolls === undefined || unemployment === undefined || wages === undefined) return []
  result.push(draft('cpi-12-month-percent', latest, cpi, 'percent', blsObservedValuePolicy.series.cpi))
  result.push(draft('core-cpi-12-month-percent', latest, core, 'percent', blsObservedValuePolicy.series.coreCpi))
  result.push(draft('nonfarm-payrolls-monthly-change-thousands', latest, payrolls, 'thousands', blsObservedValuePolicy.series.payrolls))
  result.push(draft('unemployment-rate-percent', latest, unemployment, 'percent', blsObservedValuePolicy.series.unemployment))
  result.push({ ...draft('average-hourly-earnings-monthly-percent-change', latest, wages, 'percent', blsObservedValuePolicy.series.averageHourlyEarnings), supportingObservations: support(series, blsObservedValuePolicy.series.averageHourlyEarnings, latest, previousMonth) })
  return result
}

export function parseBlsCalendarFamilyValues(payload: unknown, selection: unknown): BlsCalendarFamilyValuesResult {
  try {
    if (!isCalendarSelection(selection) || !isBlsPayload(payload) || payload.status !== blsObservedValuePolicy.calendarFamilyRequirements.successfulStatus || !payload.Results.series.every(isBlsSeries)) return unavailableFamily()
    const requirement = blsObservedValuePolicy.calendarFamilyRequirements[selection.family]
    const required = requirement.series
    if (payload.Results.series.length !== required.length) return unavailableFamily()
    const periods = requirement.periodOffsets.map((offset) => shift(selection.period, offset))
    if (periods.some((period) => !period)) return unavailableFamily()
    const records = exactSeries(payload.Results.series, required, new Set(periods))
    if (!records) return unavailableFamily()
    const [p, p1, p2, p13] = periods as `${number}-M${string}`[]
    if (selection.family === 'cpi') {
      const cpi = pairedRatios(records, blsObservedValuePolicy.series.cpi, p, p2!, p1, p13!)
      const coreCpi = pairedRatios(records, blsObservedValuePolicy.series.coreCpi, p, p2!, p1, p13!)
      if (!cpi || !coreCpi) return unavailableFamily()
      return Object.freeze({ state: 'available', family: 'cpi', period: selection.period, values: Object.freeze({ cpi: Object.freeze(cpi), coreCpi: Object.freeze(coreCpi) }) })
    }
    const nonfarm = pairedDifferences(records, blsObservedValuePolicy.series.payrolls, p, p1, p2!)
    const unemployment = pairedValues(records, blsObservedValuePolicy.series.unemployment, p, p1)
    const averageHourlyEarnings = pairedRatios(records, blsObservedValuePolicy.series.averageHourlyEarnings, p, p1, p1, p2!)
    if (!nonfarm || !unemployment || !averageHourlyEarnings) return unavailableFamily()
    return Object.freeze({
      state: 'available', family: 'employment', period: selection.period,
      values: Object.freeze({ nonfarm: Object.freeze(nonfarm), unemployment: Object.freeze(unemployment), averageHourlyEarnings: Object.freeze(averageHourlyEarnings) })
    })
  } catch {
    return unavailableFamily()
  }
}

function observations(data: BlsObservation[]): Map<string, number> | undefined {
  const values = new Map<string, number>()
  for (const item of data) {
    if (!isBlsObservation(item)) return undefined
    const period = `${item.year ?? ''}-${item.period ?? ''}`
    if (!blsObservedValuePolicy.monthPattern.test(period)) return undefined
    if (blsObservedValuePolicy.officialUnavailableMarkers.includes(item.value as never)) continue
    if (!blsObservedValuePolicy.canonicalDecimalPattern.test(item.value)) return undefined
    const value = Number(item.value)
    if (!Number.isFinite(value)) continue
    if (values.has(period)) return undefined
    values.set(period, value)
  }
  return values
}

function exactSeries(candidates: readonly (BlsSeries & { data: BlsObservation[] })[], requiredSeries: readonly string[], requiredPeriods: ReadonlySet<string>): Map<string, Map<string, number>> | undefined {
  const result = new Map<string, Map<string, number>>()
  for (const candidate of candidates) {
    const seriesId = candidate.seriesID
    if (typeof seriesId !== 'string' || !requiredSeries.includes(seriesId) || result.has(seriesId)) return undefined
    const parsed = exactObservations(candidate.data, requiredPeriods)
    if (!parsed) return undefined
    result.set(seriesId, parsed)
  }
  return result.size === requiredSeries.length ? result : undefined
}

function exactObservations(data: BlsObservation[], requiredPeriods: ReadonlySet<string>): Map<string, number> | undefined {
  const result = new Map<string, number>()
  for (const observation of data) {
    if (!isBlsObservation(observation)) return undefined
    const period = `${observation.year}-${observation.period}`
    if (!blsObservedValuePolicy.monthPattern.test(period) || !requiredPeriods.has(period)) continue
    if (blsObservedValuePolicy.officialUnavailableMarkers.includes(observation.value as never) ||
      !blsObservedValuePolicy.canonicalDecimalPattern.test(observation.value) || result.has(period)) return undefined
    const numeric = Number(observation.value)
    if (!Number.isFinite(numeric)) return undefined
    result.set(period, numeric)
  }
  return result.size === requiredPeriods.size ? result : undefined
}

function pairedRatios(series: Map<string, Map<string, number>>, seriesId: string, current: string, base: string, previous: string, previousBase: string): { actual: number; calendarPrevious: number } | undefined {
  const actual = ratio(series, seriesId, current, base)
  const calendarPrevious = ratio(series, seriesId, previous, previousBase)
  return actual === undefined || calendarPrevious === undefined || !Number.isFinite(actual) || !Number.isFinite(calendarPrevious) ? undefined : { actual, calendarPrevious }
}

function pairedDifferences(series: Map<string, Map<string, number>>, seriesId: string, current: string, previous: string, prior: string): { actual: number; calendarPrevious: number } | undefined {
  const actual = difference(series, seriesId, current, previous)
  const calendarPrevious = difference(series, seriesId, previous, prior)
  return actual === undefined || calendarPrevious === undefined || !Number.isFinite(actual) || !Number.isFinite(calendarPrevious) ? undefined : { actual, calendarPrevious }
}

function pairedValues(series: Map<string, Map<string, number>>, seriesId: string, current: string, previous: string): { actual: number; calendarPrevious: number } | undefined {
  const actual = value(series, seriesId, current)
  const calendarPrevious = value(series, seriesId, previous)
  return actual === undefined || calendarPrevious === undefined || !Number.isFinite(actual) || !Number.isFinite(calendarPrevious) ? undefined : { actual, calendarPrevious }
}

function isBlsObservation(observation: unknown): observation is BlsObservation & { year: string; period: string; value: string } {
  return typeof observation === 'object' && observation !== null && !Array.isArray(observation) &&
    typeof (observation as BlsObservation).year === 'string' &&
    typeof (observation as BlsObservation).period === 'string' &&
    typeof (observation as BlsObservation).value === 'string'
}

function latestPeriod(series: Map<string, Map<string, number>>): string | undefined {
  const candidates = [...new Set(blsObservedValuePolicy.primaryLatestPeriodSeries.flatMap((seriesId) => [...(series.get(seriesId)?.keys() ?? [])]))].sort().reverse()
  return candidates.find((period) => isCompleteSnapshotPeriod(series, period))
}

function isCompleteSnapshotPeriod(series: Map<string, Map<string, number>>, period: string): boolean {
  const previous = shift(period, -1)
  const lastYear = shift(period, -12)
  return blsObservedValuePolicy.completeSnapshotRequirements.candidateAndTwelveMonthsEarlier.every((seriesId) => value(series, seriesId, period) !== undefined && value(series, seriesId, lastYear) !== undefined) &&
    blsObservedValuePolicy.completeSnapshotRequirements.candidateAndPreviousMonth.every((seriesId) => value(series, seriesId, period) !== undefined && value(series, seriesId, previous) !== undefined) &&
    blsObservedValuePolicy.completeSnapshotRequirements.candidateOnly.every((seriesId) => value(series, seriesId, period) !== undefined) &&
    blsObservedValuePolicy.completeSnapshotRequirements.nonzeroDenominator.twelveMonthsEarlier.every((seriesId) => value(series, seriesId, lastYear) !== 0) &&
    blsObservedValuePolicy.completeSnapshotRequirements.nonzeroDenominator.previousMonth.every((seriesId) => value(series, seriesId, previous) !== 0) &&
    hasFiniteDerivedMetrics(series, period, previous, lastYear)
}

function hasFiniteDerivedMetrics(series: Map<string, Map<string, number>>, period: string, previous: string, lastYear: string): boolean {
  const metrics = [
    ratio(series, blsObservedValuePolicy.series.cpi, period, lastYear),
    ratio(series, blsObservedValuePolicy.series.coreCpi, period, lastYear),
    difference(series, blsObservedValuePolicy.series.payrolls, period, previous),
    value(series, blsObservedValuePolicy.series.unemployment, period),
    ratio(series, blsObservedValuePolicy.series.averageHourlyEarnings, period, previous)
  ]
  return metrics.every((metric) => metric !== undefined && Number.isFinite(metric))
}

function isBlsPayload(payload: unknown): payload is BlsPayload & { Results: { series: BlsSeries[] } } {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) &&
    typeof (payload as BlsPayload).Results === 'object' && (payload as BlsPayload).Results !== null &&
    Array.isArray((payload as BlsPayload).Results?.series)
}

function isBlsSeries(series: unknown): series is BlsSeries & { data: BlsObservation[] } {
  return typeof series === 'object' && series !== null && !Array.isArray(series) && Array.isArray((series as BlsSeries).data)
}

function isCalendarSelection(value: unknown): value is Readonly<{ family: 'cpi' | 'employment'; period: `${number}-M${string}` }> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 2 &&
    ((value as { family?: unknown }).family === 'cpi' || (value as { family?: unknown }).family === 'employment') &&
    typeof (value as { period?: unknown }).period === 'string' && blsObservedValuePolicy.monthPattern.test((value as { period: string }).period)
}

function shift(period: string, offset: number): string {
  const [year, month] = period.match(/^(\d{4})-M(\d{2})$/)?.slice(1).map(Number) ?? []
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-M${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function value(series: Map<string, Map<string, number>>, seriesId: string, period: string): number | undefined { return series.get(seriesId)?.get(period) }
function difference(series: Map<string, Map<string, number>>, seriesId: string, current: string, previous: string): number | undefined {
  const a = value(series, seriesId, current); const b = value(series, seriesId, previous)
  return a === undefined || b === undefined ? undefined : a - b
}
function ratio(series: Map<string, Map<string, number>>, seriesId: string, current: string, previous: string): number | undefined {
  const a = value(series, seriesId, current); const b = value(series, seriesId, previous)
  return a === undefined || b === undefined || b === 0 ? undefined : ((a / b) - 1) * 100
}
function draft(metric: BlsObservedValueDraft['metric'], observedPeriod: string, value: number, unit: BlsObservedValueDraft['unit'], seriesId: string): BlsObservedValueDraft { return { metric, observedPeriod, value, unit, seriesId } }
function support(series: Map<string, Map<string, number>>, seriesId: string, current: string, previous: string): BlsObservedValueDraft['supportingObservations'] { return [{ seriesId, observedPeriod: current, value: value(series, seriesId, current)! }, { seriesId, observedPeriod: previous, value: value(series, seriesId, previous)! }] }
function unavailableFamily(): BlsCalendarFamilyValuesResult { return Object.freeze({ state: 'unavailable' }) }
