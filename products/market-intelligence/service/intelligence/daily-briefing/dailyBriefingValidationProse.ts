import type { BriefingConclusionSynthesis } from '../../../contracts/dailyBriefing'

/**
 * Every reader-facing sentence one editorial reply produced, as one string.
 *
 * The validators below scan this text for banned wording, invented numbers and copied passages, and
 * they all scan the same text: two of them assembling their own list would eventually scan different
 * sentences and disagree about what the reply says.
 */
export function editorialProse(input: Readonly<{
  lede: string
  items: readonly Readonly<{ why: string }>[]
  importance: readonly Readonly<{ reasonText?: string }>[]
  nextFocus?: Readonly<{ why: string; watch: readonly Readonly<{ condition: string; implication: string }>[] }>
  dataNote?: string | false
  invalidationNote?: string | false
  conclusionTranslation?: string | false
  conclusionSynthesis?: BriefingConclusionSynthesis
}>): string {
  const { lede, items, importance, nextFocus, dataNote, invalidationNote, conclusionTranslation, conclusionSynthesis } = input
  return [
    lede,
    ...items.map((item) => item.why),
    ...importance.map((entry) => entry.reasonText ?? ''),
    ...(nextFocus ? [nextFocus.why, ...nextFocus.watch.flatMap((entry) => [entry.condition, entry.implication])] : []),
    ...(typeof dataNote === 'string' ? [dataNote] : []),
    ...(typeof invalidationNote === 'string' ? [invalidationNote] : []),
    ...(typeof conclusionTranslation === 'string' ? [conclusionTranslation] : []),
    ...(conclusionSynthesis ? [
      conclusionSynthesis.summary,
      conclusionSynthesis.outlook,
      conclusionSynthesis.regimeChange,
      conclusionSynthesis.coreTension,
      conclusionSynthesis.whatWouldChange,
      ...conclusionSynthesis.conditions,
      ...conclusionSynthesis.counterEvidence,
      ...conclusionSynthesis.watch,
      ...conclusionSynthesis.confirmed,
      ...conclusionSynthesis.refuted
    ] : [])
  ].join('\n')
}
