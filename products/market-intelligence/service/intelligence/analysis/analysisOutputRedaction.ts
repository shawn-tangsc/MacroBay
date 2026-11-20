import { isMarketAnalysisFiniteNumber } from '../../../contracts/marketAnalysisContracts'
import { marketAnalysisUnsafeOutputPolicy } from './analysisConstants'

/**
 * 模型输出里的违禁内容怎么抹掉、抹掉了什么怎么留痕。
 *
 * 从 `analysisOutputValidator` 抽出来（那个文件越过 500 行软上限）：这里不做契约校验，
 * 只遍历输出、替换违禁模式，并给出一条可检索的 marker；校验本身仍留在原文件。
 */

export type AnalysisOutputRedaction = Readonly<{ path: string; pattern: string }>

/**
 * Removes prohibited patterns from every string in the payload, in place.
 *
 * The walker visits keys as well as values, so a pattern cannot survive by hiding in
 * a field name, and it reports each removal with its JSON path.
 */
export function redactUnsafeOutput(value: unknown): { value: unknown; redactions: readonly AnalysisOutputRedaction[] } {
  const redactions: AnalysisOutputRedaction[] = []
  const walk = (item: unknown, path: string): unknown => {
    if (typeof item === 'string') {
      let next = item
      for (const pattern of marketAnalysisUnsafeOutputPolicy.prohibitedPatterns) {
        if (!pattern.test(next)) continue
        next = next.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), marketAnalysisUnsafeOutputPolicy.redactionToken)
        redactions.push({ path, pattern: pattern.source })
      }
      return next
    }
    if (Array.isArray(item)) return item.map((entry, index) => walk(entry, `${path}[${index}]`))
    if (isPlainRecord(item)) {
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(item)) {
        const safeKey = typeof key === 'string' ? walk(key, `${path}.${key}#key`) as string : key
        result[safeKey] = walk(entry, `${path}.${key}`)
      }
      return result
    }
    return item
  }
  return { value: walk(value, ''), redactions }
}

export function containsUnsafeOutput(value: unknown): boolean {
  if (typeof value === 'string') return marketAnalysisUnsafeOutputPolicy.prohibitedPatterns.some((pattern) => pattern.test(value))
  if (Array.isArray(value)) return value.some(containsUnsafeOutput)
  if (isPlainRecord(value)) return Object.entries(value).some(([key, item]) => containsUnsafeOutput(key) || containsUnsafeOutput(item))
  return typeof value === 'number' && !isMarketAnalysisFiniteNumber(value)
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * One-line record of what was removed from a model output.
 *
 * Without it a removed URL is invisible: the run succeeds and nobody can tell that
 * part of the conclusion was rewritten.
 */
export function formatUnsafeOutputRedaction(runId: string, redactions: readonly AnalysisOutputRedaction[]): string {
  const fields = [...new Set(redactions.map(redaction => redaction.path))]
  return JSON.stringify({ marker: 'MI_ANALYSIS_REDACTION', runId, count: redactions.length, fields })
}
