type OtlpAnyValue = {
  stringValue?: string
  boolValue?: boolean
  intValue?: number | string
  doubleValue?: number | string
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
}

type OtlpKeyValue = {
  key?: string
  value?: OtlpAnyValue
}

type OtlpSpan = {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  name?: string
  kind?: string | number
  startTimeUnixNano?: string | number
  endTimeUnixNano?: string | number
  attributes?: OtlpKeyValue[]
  status?: {
    code?: string | number
    message?: string
  }
}

export type AgentOtlpSpanSummary = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeMs: number
  endTimeMs: number | null
  status: 'UNSET' | 'OK' | 'ERROR'
  kind: string
  attributes: Record<string, string | number | boolean>
}

export type AgentOtlpLogSummary = {
  traceId: string
  spanId: string
  timeMs: number
  severityText: string
  body: string
  attributes: Record<string, string | number | boolean>
}

const SENSITIVE_ATTRIBUTE_KEYS = [
  'gen_ai.prompt',
  'gen_ai.completion',
  'user.prompt',
  'prompt',
  'input',
  'output',
  'tool.content',
  'tool.input',
  'tool.output',
  'raw_api_request',
  'raw_api_response'
]

export class AgentOtlpPayloadAdapter {
  static spansFromPayload(
    payload: unknown,
    options: { includePrompts?: boolean; includeToolContent?: boolean } = {}
  ): AgentOtlpSpanSummary[] {
    const result: AgentOtlpSpanSummary[] = []
    const resourceSpans = asArray((payload as { resourceSpans?: unknown })?.resourceSpans)

    for (const resourceSpan of resourceSpans) {
      const resourceAttributes = prefixAttributes(
        attributesFromKeyValues((resourceSpan as { resource?: { attributes?: OtlpKeyValue[] } }).resource?.attributes),
        'resource.'
      )
      const scopeSpans = asArray((resourceSpan as { scopeSpans?: unknown }).scopeSpans)

      for (const scopeSpan of scopeSpans) {
        const scopeAttributes = prefixAttributes(
          attributesFromKeyValues((scopeSpan as { scope?: { attributes?: OtlpKeyValue[] } }).scope?.attributes),
          'scope.'
        )
        const spans = asArray((scopeSpan as { spans?: unknown }).spans) as OtlpSpan[]
        for (const span of spans) {
          const summary = convertSpan(span, { ...resourceAttributes, ...scopeAttributes }, options)
          if (summary) result.push(summary)
        }
      }
    }

    return result
  }

  static logsFromPayload(
    payload: unknown,
    options: { includePrompts?: boolean; includeToolContent?: boolean } = {}
  ): AgentOtlpLogSummary[] {
    const result: AgentOtlpLogSummary[] = []
    const resourceLogs = asArray((payload as { resourceLogs?: unknown })?.resourceLogs)

    for (const resourceLog of resourceLogs) {
      const resourceAttributes = prefixAttributes(
        attributesFromKeyValues((resourceLog as { resource?: { attributes?: OtlpKeyValue[] } }).resource?.attributes),
        'resource.'
      )
      const scopeLogs = asArray((resourceLog as { scopeLogs?: unknown }).scopeLogs)

      for (const scopeLog of scopeLogs) {
        const scopeAttributes = prefixAttributes(
          attributesFromKeyValues((scopeLog as { scope?: { attributes?: OtlpKeyValue[] } }).scope?.attributes),
          'scope.'
        )
        const records = asArray((scopeLog as { logRecords?: unknown }).logRecords) as Array<{
          traceId?: string
          spanId?: string
          timeUnixNano?: string | number
          severityText?: string
          body?: OtlpAnyValue
          attributes?: OtlpKeyValue[]
        }>

        for (const record of records) {
          if (!record.traceId || !record.spanId || !isTraceId(record.traceId) || !isSpanId(record.spanId)) continue
          result.push({
            traceId: record.traceId.toLowerCase(),
            spanId: record.spanId.toLowerCase(),
            timeMs: unixNanoToMillis(record.timeUnixNano),
            severityText: record.severityText ?? 'INFO',
            body: stringifyAnyValue(record.body),
            attributes: sanitizeAttributes(
              { ...resourceAttributes, ...scopeAttributes, ...attributesFromKeyValues(record.attributes) },
              options
            )
          })
        }
      }
    }

    return result
  }
}

function convertSpan(
  span: OtlpSpan,
  inheritedAttributes: Record<string, string | number | boolean>,
  options: { includePrompts?: boolean; includeToolContent?: boolean }
): AgentOtlpSpanSummary | undefined {
  if (!span.traceId || !span.spanId || !isTraceId(span.traceId) || !isSpanId(span.spanId)) return undefined
  return {
    traceId: span.traceId.toLowerCase(),
    spanId: span.spanId.toLowerCase(),
    ...(span.parentSpanId && isSpanId(span.parentSpanId)
      ? { parentSpanId: span.parentSpanId.toLowerCase() }
      : {}),
    name: span.name || 'agent.span',
    startTimeMs: unixNanoToMillis(span.startTimeUnixNano),
    endTimeMs: span.endTimeUnixNano === undefined ? null : unixNanoToMillis(span.endTimeUnixNano),
    status: normalizeStatus(span.status?.code),
    kind: normalizeKind(span.kind),
    attributes: sanitizeAttributes(
      { ...inheritedAttributes, ...attributesFromKeyValues(span.attributes) },
      options
    )
  }
}

function sanitizeAttributes(
  attributes: Record<string, string | number | boolean>,
  options: { includePrompts?: boolean; includeToolContent?: boolean }
): Record<string, string | number | boolean> {
  const next: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    const lower = key.toLowerCase()
    const isPrompt = SENSITIVE_ATTRIBUTE_KEYS.some((item) => lower.includes(item)) || lower.includes('prompt')
    const isToolContent =
      lower.includes('tool.content') || lower.includes('tool.input') || lower.includes('tool.output')
    if (isPrompt && !options.includePrompts) continue
    if (isToolContent && !options.includeToolContent) continue
    next[key] = value
  }
  return next
}

function attributesFromKeyValues(values: OtlpKeyValue[] | undefined): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const item of values ?? []) {
    if (!item.key || !item.value) continue
    const value = flattenAnyValue(item.value)
    if (value !== undefined) result[item.key] = value
  }
  return result
}

function flattenAnyValue(value: OtlpAnyValue): string | number | boolean | undefined {
  if (typeof value.stringValue === 'string') return value.stringValue
  if (typeof value.boolValue === 'boolean') return value.boolValue
  if (typeof value.intValue === 'number') return value.intValue
  if (typeof value.intValue === 'string' && value.intValue.trim()) return Number(value.intValue)
  if (typeof value.doubleValue === 'number') return value.doubleValue
  if (typeof value.doubleValue === 'string' && value.doubleValue.trim()) return Number(value.doubleValue)
  if (value.arrayValue?.values) return value.arrayValue.values.map((entry) => stringifyAnyValue(entry)).join(',')
  if (value.kvlistValue?.values) return JSON.stringify(attributesFromKeyValues(value.kvlistValue.values))
  return undefined
}

function stringifyAnyValue(value: OtlpAnyValue | undefined): string {
  if (!value) return ''
  const flattened = flattenAnyValue(value)
  return flattened === undefined ? '' : String(flattened)
}

function prefixAttributes(
  attributes: Record<string, string | number | boolean>,
  prefix: string
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    result[`${prefix}${key}`] = value
  }
  return result
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function unixNanoToMillis(value: string | number | undefined): number {
  if (value === undefined) return 0
  const asNumber = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(asNumber)) return 0
  return Math.floor(asNumber / 1_000_000)
}

function normalizeStatus(value: string | number | undefined): 'UNSET' | 'OK' | 'ERROR' {
  const key = String(value ?? 'UNSET').toUpperCase()
  if (key === '1' || key === 'OK' || key === 'STATUS_CODE_OK') return 'OK'
  if (key === '2' || key === 'ERROR' || key === 'STATUS_CODE_ERROR') return 'ERROR'
  return 'UNSET'
}

function normalizeKind(value: string | number | undefined): string {
  const key = String(value ?? 'INTERNAL').toUpperCase()
  if (key === '2' || key === 'SERVER' || key === 'SPAN_KIND_SERVER') return 'SERVER'
  if (key === '3' || key === 'CLIENT' || key === 'SPAN_KIND_CLIENT') return 'CLIENT'
  if (key === '4' || key === 'PRODUCER' || key === 'SPAN_KIND_PRODUCER') return 'PRODUCER'
  if (key === '5' || key === 'CONSUMER' || key === 'SPAN_KIND_CONSUMER') return 'CONSUMER'
  return 'INTERNAL'
}

function isTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value) && value !== '00000000000000000000000000000000'
}

function isSpanId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value) && value !== '0000000000000000'
}
