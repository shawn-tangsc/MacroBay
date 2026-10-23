const blsObservedValuesRequestPolicy = {
  seriesIds: [
    'CUUR0000SA0',
    'CUUR0000SA0L1E',
    'CES0000000001',
    'LNS14000000',
    'CES0500000003',
    'CES0500000001'
  ],
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export function buildBlsObservedValuesRequest(runAt: string): string | undefined {
  if (!isCanonicalUtcMillis(runAt)) return undefined
  const year = new Date(Date.parse(runAt)).getUTCFullYear()
  return JSON.stringify({
    seriesid: blsObservedValuesRequestPolicy.seriesIds,
    startyear: String(year - 1),
    endyear: String(year)
  })
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !blsObservedValuesRequestPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}
