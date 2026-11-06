import type { AnalysisConclusionDirection } from '../../../contracts/marketAnalysisContracts'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/** What a run froze: the rows and the verdict every version is written against. */
export type DailyBriefingPeriodFacts = Readonly<{
  rowIds: readonly string[]
  direction: AnalysisConclusionDirection
}>

/**
 * The row set and the direction of one period, derived once from the facts.
 *
 * Two editions of a period must carry the same rows in the same order and the same verdict. Both
 * are facts, not writing: the row set is read off the frozen document, and the direction is the
 * data layer's own conclusion. Deriving either here — instead of in the builder, the editor, and
 * the renderer each — is what makes "identical" checkable rather than hopeful.
 */
export function briefingEditionRowIds(document: DailyBriefingDocument): readonly string[] {
  const rows: string[] = []
  for (const row of document.data.market) rows.push(`market:${row.id}`)
  for (const row of document.data.funds) rows.push(`funds:${row.id}`)
  if (document.data.sentiment.fearGreed) rows.push('sentiment:fear-greed')
  if (document.data.policyPath) rows.push('data:policy-path')
  if (document.data.leverage) rows.push('data:leverage')
  return Object.freeze(rows)
}

/**
 * The data layer's verdict. An edition with no analysis conclusion has none — `undecided` is a
 * value, not a guess, and the writer is not held to a direction nobody computed.
 */
export function briefingFactDirection(document: DailyBriefingDocument): AnalysisConclusionDirection {
  return document.conclusion?.direction ?? 'undecided'
}

/** Only the two opposing calls conflict; a range, a mixed or an undecided verdict does not. */
export function isOppositeDirection(written: AnalysisConclusionDirection, facts: AnalysisConclusionDirection): boolean {
  return (written === 'bullish' && facts === 'bearish') || (written === 'bearish' && facts === 'bullish')
}


/**
 * The document a version is written from: the frozen document with only the rows this run agreed
 * on. Passing the rows in — instead of letting the writer read the packet again — is what makes
 * "the same rows for every version" an input the caller controls, and what lets a test prove the
 * writer does not invent a row of its own.
 */
export function restrictEditionRows(document: DailyBriefingDocument, rowIds: readonly string[]): DailyBriefingDocument {
  const keep = new Set(rowIds)
  const data = document.data
  return Object.freeze({
    ...document,
    data: Object.freeze({
      market: Object.freeze(data.market.filter((row) => keep.has(`market:${row.id}`))),
      funds: Object.freeze(data.funds.filter((row) => keep.has(`funds:${row.id}`))),
      sentiment: Object.freeze({
        fearGreed: keep.has('sentiment:fear-greed') ? data.sentiment.fearGreed : null,
        news: data.sentiment.news
      }),
      ...(data.policyPath && keep.has('data:policy-path') ? { policyPath: data.policyPath } : {}),
      ...(data.leverage && keep.has('data:leverage') ? { leverage: data.leverage } : {})
    })
  })
}

/** The first row id that only one of the two documents carries, or `undefined` when they match. */
export function firstRowSetDifference(expected: readonly string[], actual: readonly string[]): string | undefined {
  // Name the row that is missing or extra first: "which row" is what the reader of the failure
  // needs, and a plain positional walk would blame the row that moved up instead.
  const actualIds = new Set(actual)
  for (const id of expected) if (!actualIds.has(id)) return id
  const expectedIds = new Set(expected)
  for (const id of actual) if (!expectedIds.has(id)) return id
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) return actual[index] ?? expected[index]
  }
  return undefined
}


/**
 * The one rule both editions are held to: the writer may not call the opposite verdict, and may not
 * add or drop a frozen row. Returns the failure code, so the caller reports it instead of guessing.
 */
export function periodFactsFailure(
  document: DailyBriefingDocument,
  facts: DailyBriefingPeriodFacts,
  writtenDirection?: AnalysisConclusionDirection
): 'direction-conflict' | 'row-set-mismatch' | undefined {
  if (writtenDirection && isOppositeDirection(writtenDirection, facts.direction)) return 'direction-conflict'
  if (firstRowSetDifference(facts.rowIds, briefingEditionRowIds(document))) return 'row-set-mismatch'
  return undefined
}
