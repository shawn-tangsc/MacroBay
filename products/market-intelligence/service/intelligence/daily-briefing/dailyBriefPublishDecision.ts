/**
 * Whether this run publishes, publishes with gaps, or does not publish at all — decided in one place.
 *
 * The reader's rule (2026-11-04): **if a readable brief can be assembled, it must be published.** A
 * field that fails validation, a missing quote, a model that is not configured, data that arrived
 * late — none of those is a reason for the day to have no brief. What they are is a reason for the
 * brief to say what is incomplete.
 *
 * Before this, the decision was spread across the generation path, the failure panel and the page:
 * each decided for itself whether a failure was fatal, which is how a single word order in one field
 * produced "AI 编辑失败，日报未生成" for the whole day.
 *
 * The order is the semantics, and it is fixed:
 *
 * 1. `canceled` — the reader stopped it. Nothing is published and no error is rendered: the run
 *    returns to what it looked like before the click. Cancelling is not a failure.
 * 2. `!factsUsable` — not one usable fact. This is the only real failure: there is nothing to read.
 * 3. `modelState !== 'available'` or any validation failure — publish what there is, with the
 *    problems as gap entries. A missing model yields the fact layer, exactly as it always has.
 * 4. otherwise — publish.
 */
export type PublishDecision = 'canceled' | 'fail' | 'publish-with-gaps' | 'publish'

export type PublishInput = Readonly<{
  /** At least one usable fact: a market row, an ETF flow, a calendar event, a news item. */
  factsUsable: boolean
  /** The reader cancelled this run (or the window closed on it). */
  canceled: boolean
  /** Whether the editorial model could be used at all. */
  modelState: 'available' | 'unavailable'
  /** How many items failed validation, after every repair round the policy allows. */
  validationFailures: number
}>

export function decidePublish(input: PublishInput): PublishDecision {
  if (input.canceled) return 'canceled'
  if (!input.factsUsable) return 'fail'
  if (input.modelState !== 'available') return 'publish-with-gaps'
  if (input.validationFailures > 0) return 'publish-with-gaps'
  return 'publish'
}
