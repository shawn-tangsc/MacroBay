import type { DailyBriefingCompleteness } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The one place the export's completeness sentence is produced.
 *
 * The image and the history rail must not decide "incomplete" for themselves: the decision is made
 * once (`briefingCompleteness`) and this turns it into the sentence the image may carry. A complete
 * edition — including a single-language one that published normally — produces nothing at all, so
 * the caller renders nothing instead of a reassurance nobody asked for.
 *
 * "未完整" is the history rail's word and deliberately not in this vocabulary.
 */
export function buildEditionCompletenessNote(
  completeness: DailyBriefingCompleteness | undefined,
  text: Pick<DailyBriefingText, 'completeness'>
): string | undefined {
  if (!completeness) return undefined
  if (completeness.state === 'missing-version') return text.completeness.missingVersion
  if (completeness.state === 'missing-readings') return text.completeness.missingReadings.replace('{n}', String(completeness.count))
  return undefined
}
