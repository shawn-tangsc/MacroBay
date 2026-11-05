import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/**
 * The one sentence for an empty macro section (`A0.8`), shared by the paper and the issue list.
 *
 * Two surfaces say why the section is empty — the section itself and "数据缺口与限制" — and the
 * acceptance requires them to be **the same sentence**. Sharing the derivation is the only way that
 * stays true after someone adds a reason code: a second copy of the mapping drifts on the first edit.
 *
 * `unreadable` is carried, not merely implied by the sentence, because the caller must be able to
 * style "could not read it" differently from "there really was nothing" without re-testing the code.
 */
export type BriefingMacroEmptyCopy = Readonly<{
  sentence: string
  /** `true` for every reason except "the data is fresh and the window really is empty". */
  unreadable: boolean
}>

export type BriefingMacroEmptyCopyLabels = Readonly<{
  macroEmptyCodes: Readonly<Record<string, string>>
  emptyMacro: string
  /** The prefix that turns a reason into a sentence the reader understands, e.g. "暂时读不到：". */
  macroUnreadable: string
}>

export function briefingMacroEmptyCopy(
  document: Pick<DailyBriefingDocument, 'news'>,
  labels: BriefingMacroEmptyCopyLabels
): BriefingMacroEmptyCopy | null {
  const code = document.news.notes.macroEmpty
  // No note: an edition written before reasons were recorded. Saying nothing is the only honest
  // answer — the sentence would have to invent which of the six reasons applied.
  if (!code) return null
  const reason = labels.macroEmptyCodes[code] ?? labels.emptyMacro
  if (code === 'past-24h-no-high-impact-release') return { sentence: reason, unreadable: false }
  const hours = document.news.notes.macroEmptyHours
  const filled = hours === undefined ? reason : reason.replace('{hours}', String(hours))
  return { sentence: `${labels.macroUnreadable}${filled}`, unreadable: true }
}
