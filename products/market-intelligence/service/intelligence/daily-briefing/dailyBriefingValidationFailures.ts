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
