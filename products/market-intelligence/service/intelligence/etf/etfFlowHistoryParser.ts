export type EtfFlowHistoryRow = Readonly<{
  date: number
  changeUsd: number
  updateTime?: string
}>

export type EtfFlowHistoryParseResult =
  | Readonly<{ state: 'available'; rows: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'unavailable' }>

export const etfFlowHistoryParserPolicy = Object.freeze({
  successCode: 200,
  envelopeFields: Object.freeze(['code', 'msg', 'data']),
  requiredRowFields: Object.freeze(['date', 'changeUsd']),
  optionalUpdateTimeField: 'updateTime',
})

/** Strictly converts only the authorized top-level ETF flow-history structure. */
export function parseEtfFlowHistoryResponse(body: string): EtfFlowHistoryParseResult {
  try {
    const value = JSON.parse(body) as unknown
    const rows = parseRows(value)
    return rows ? Object.freeze({ state: 'available' as const, rows: Object.freeze(rows) }) : unavailable()
  } catch {
    return unavailable()
  }
}

export function hasObservedEtfFlowHistoryShape(body: string): boolean {
  return parseEtfFlowHistoryResponse(body).state === 'available'
}

function parseRows(value: unknown): readonly EtfFlowHistoryRow[] | undefined {
  if (!plainObject(value) || !hasExactKeys(value, etfFlowHistoryParserPolicy.envelopeFields) || value.code !== etfFlowHistoryParserPolicy.successCode || typeof value.msg !== 'string' || !Array.isArray(value.data)) return undefined
  if (value.data.length === 0) return undefined
  const rows: EtfFlowHistoryRow[] = []
  for (const valueRow of value.data) {
    const row = parseRow(valueRow)
    if (!row) return undefined
    rows.push(row)
  }
  return rows
}

function parseRow(value: unknown): EtfFlowHistoryRow | undefined {
  if (!plainObject(value)) return undefined
  const hasUpdateTime = Object.hasOwn(value, etfFlowHistoryParserPolicy.optionalUpdateTimeField)
  if (!isFiniteNumber(value.date) || !isFiniteNumber(value.changeUsd)) return undefined
  const updateTime = hasUpdateTime && ((typeof value.updateTime === 'string' && value.updateTime.length > 0) || isFiniteNumber(value.updateTime)) ? String(value.updateTime) : undefined
  if (hasUpdateTime && updateTime === undefined) return undefined
  return Object.freeze({
    date: value.date,
    changeUsd: value.changeUsd,
    ...(updateTime !== undefined ? { updateTime } : {})
  })
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const allowed = [...keys].sort()
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index])
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function unavailable(): Extract<EtfFlowHistoryParseResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
