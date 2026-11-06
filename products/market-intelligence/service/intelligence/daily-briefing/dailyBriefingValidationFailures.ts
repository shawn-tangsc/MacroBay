import type { DailyBriefingValidationFailure } from './dailyBriefingValidation'

/**
 * Every independent defect one reply had, not just the first.
 *
 * A repair round that hears one defect spends the round on it and leaves the rest untouched: three
 * writes in one evening each cleared a different field, and the edition still failed on a field the
 * model had never been told about. The first defect stays the verdict; the rest travel with it.
 */
export type DailyBriefingValidationFailureEntry = Readonly<{
  code: DailyBriefingValidationFailure
  detail?: string
}>

export type DailyBriefingValidationFailureResult = Readonly<{
  ok: false
  failureCode: DailyBriefingValidationFailure
  detail?: string
  failures?: readonly DailyBriefingValidationFailureEntry[]
}>

export function failAll(issues: readonly DailyBriefingValidationFailureEntry[]): DailyBriefingValidationFailureResult {
  const [first] = issues
  return Object.freeze({
    ok: false as const,
    failureCode: first!.code,
    ...(first!.detail ? { detail: first!.detail } : {}),
    failures: Object.freeze([...issues])
  })
}

/**
 * Every defect in one line, for the reader and for the record.
 *
 * The repair prompt gets the full list with each field's legal form; what travels with the failure — into
 * the attempt, into the edition's provenance and onto the panel — used to be the first defect alone, which
 * is how "AI 输出格式不合规" became the only sentence a reader ever saw. The line names each field once, in
 * order, and says how many more there were rather than truncating silently.
 */
export function describeFailures(failures: readonly Readonly<{ code: string; detail?: string }>[], maximum = 5): string | undefined {
  const named: string[] = []
  for (const failure of failures) {
    const text = failure.detail ? `${failure.detail}（${failure.code}）` : failure.code
    if (!named.includes(text)) named.push(text)
  }
  if (named.length === 0) return undefined
  const shown = named.slice(0, maximum)
  return named.length > maximum ? `${shown.join(' · ')} · +${named.length - maximum}` : shown.join(' · ')
}
