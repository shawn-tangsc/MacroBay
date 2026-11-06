import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { isExact } from '../macro-calendar/macroCalendarResultGuards'
import { hasBriefingNextTransmission } from './dailyBriefingValidation'

type NextFocus = Readonly<{
  eventKey: string
  why: string
  watch: readonly Readonly<{ condition: string; implication: string }>[]
}>

/**
 * The reply's optional next-focus block, accepted only when it is about this edition's focus.
 *
 * An unusable block is ignored rather than refused: the page has its own deterministic focus, and a
 * chatty optional field must never cost the edition. That is why this returns `undefined` and never
 * a failure.
 */
export function validatedNextFocus(raw: unknown, document: DailyBriefingDocument): NextFocus | undefined {
  if (raw === undefined || !isExact(raw, ['eventKey', 'why', 'watch'])) return undefined
  const focusKey = document.next.focus?.eventKey
  const watchRaw = raw.watch
  const watchCount = Array.isArray(watchRaw) ? watchRaw.length : 0
  const watch = Array.isArray(watchRaw) && watchCount >= 2 && watchCount <= 3
    ? watchRaw.filter((entry): entry is { condition: string; implication: string } =>
      isExact(entry, ['condition', 'implication']) && typeof entry.condition === 'string' && typeof entry.implication === 'string')
    : []
  if (!focusKey || raw.eventKey !== focusKey || typeof raw.why !== 'string' || raw.why.length > 200) return undefined
  if (!hasBriefingNextTransmission(raw.why) || watch.length !== watchCount) return undefined
  if (!watch.every((entry) => entry.condition.length <= 80 && entry.implication.length <= 160)) return undefined
  return Object.freeze({
    eventKey: raw.eventKey,
    why: raw.why,
    watch: Object.freeze(watch.map((entry) => Object.freeze(entry)))
  })
}
