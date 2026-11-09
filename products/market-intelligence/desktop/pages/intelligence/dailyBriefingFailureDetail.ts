/**
 * The one place model/service failure text is made safe to show.
 *
 * A failure detail can be a stack trace or an error that echoes a credential. It is never rendered
 * raw: cut at the first stack frame, redact key-shaped fragments, then trim to a readable length.
 * Both the failure panel and the generation timeline call this, so two surfaces cannot disagree
 * about what is safe to display.
 */
export const FAILURE_DETAIL_LIMIT = 160

export function readableFailureDetail(
  detail: string | undefined,
  labels: Readonly<Record<string, string>>
): string | undefined {
  if (!detail) return undefined
  const mapped = Object.hasOwn(labels, detail) ? labels[detail] : undefined
  if (mapped) return mapped
  const stackAt = detail.search(/\n\s*at\s/)
  const withoutStack = stackAt >= 0 ? detail.slice(0, stackAt) : detail
  const cleaned = withoutStack
    .replace(/\r?\n/g, ' ')
    .replace(/(?:sk|pk|api|key)[-_][A-Za-z0-9_-]{6,}/gi, '[redacted]')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.length > FAILURE_DETAIL_LIMIT ? `${cleaned.slice(0, FAILURE_DETAIL_LIMIT)}…` : cleaned
}

export type BriefFailureAdvice = 'model' | 'retryOrModel' | 'retryOrSettings' | 'data' | 'system'

/**
 * The reason a generation stopped is a machine code from the service; the panel shows a readable
 * label and a next step instead. Model/provider failures send the reader to model settings, output
 * failures to a retry, and collection failures to the sources.
 */
export function failureAdvice(code: string | undefined): BriefFailureAdvice {
  switch (code) {
    case 'model-unavailable':
    case 'model-not-ready':
    case 'provider-disabled':
    case 'missing-api-key':
      return 'model'
    case 'editorial-timeout':
    case 'agent-turn-output-truncated':
    case 'timeout':
    case 'invalid-output-language':
      return 'retryOrModel'
    case 'source-failed':
    case 'candidate-overflow':
    case 'build-failed':
      return 'data'
    case 'store-failed':
    case 'time-invalid':
      return 'system'
    default:
      return 'retryOrSettings'
  }
}

/** Conclusion-validation failures: the reader is told the class, never the internal ids behind it. */
const conclusionFailureCodes: ReadonlySet<string> = new Set([
  'invalid-conclusion-synthesis', 'missing-conclusion-synthesis', 'missing-conclusion-evidence',
  'missing-conclusion-divergence', 'missing-mechanism', 'data-only-summary', 'missing-outlook',
  'repeated-direction', 'duplicate-statement', 'invalid-number-format',
  'copied-conclusion', 'asset-equality-claim', 'direction-conflict', 'row-set-mismatch'
])

/** The reader-facing name of a failure: a known code's own sentence, or the class it belongs to. */
export function briefFailureCodeLabel(code: string | undefined, labels: Readonly<{ failure: Record<string, string>; failurePanel: Readonly<{ unknownCode: string; conclusionRejected: string }> }>): string {
  if (!code) return labels.failurePanel.unknownCode
  return labels.failure[code]
    ?? (conclusionFailureCodes.has(code) ? labels.failurePanel.conclusionRejected : labels.failurePanel.unknownCode)
}

/**
 * 详情行里不许出现内部写法的那几个码。
 *
 * 结论校验的 detail 是写给模型看的字段诊断（`missing: outlook`、`summary: ...`），
 * 另外三种（隐去原因、宏观 why）带的是内部 id 或英文指令。读者要的是「缺哪一项」，
 * 不是这些串——所以这些码一律由 `conclusionReaderDetail` 决定详情行，绝不回落到原文。
 */
const internalDetailCodes: ReadonlySet<string> = new Set([
  ...conclusionFailureCodes,
  'missing-hidden-reason', 'missing-macro-why', 'invalid-macro-why'
])

export function failureDetailIsInternal(code: string | undefined): boolean {
  return code !== undefined && internalDetailCodes.has(code)
}

/**
 * 结论类失败的详情：只说「缺哪一项」或「问题在哪个字段」，用读者语言。
 *
 * - `missing: outlook, counterEvidence` → “缺：未来判断、反证条件”；
 * - `summary`（重复方向/照抄这类以字段名做 detail）→ “问题在：摘要”；
 * - 其它英文指令（例如 outlook 的写法要求）→ 不显示详情行：句子已经说了发生了什么，
 *   把「该按什么格式写」印给读者只会多一句他改不动的话。
 */
export function conclusionReaderDetail(
  code: string | undefined,
  detail: string | undefined,
  labels: Readonly<{
    missing: string
    problem: string
    separator: string
    fields: Readonly<Record<string, string>>
  }>
): string | undefined {
  if (!failureDetailIsInternal(code) || detail === undefined) return undefined
  const missing = /^missing: ([^;]+)/.exec(detail)
  if (missing) {
    const names = missing[1]
      .split(',')
      .map((field) => field.trim())
      .filter((field) => labels.fields[field] !== undefined)
      .map((field) => labels.fields[field] as string)
    return names.length === 0 ? undefined : labels.missing.replace('{fields}', names.join(labels.separator))
  }
  const field = labels.fields[detail]
  return field === undefined ? undefined : labels.problem.replace('{field}', field)
}
