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
  /**
   * 第三种：数据是新的、窗口里**有**高影响事件，但截至这一刻还没拿到它们的实际值。
   * 既不是「没有」（断事实），也不是「读不到」（读是成功的）——所以它自己一档，不借前两者的话。
   */
  pending?: boolean
}>

export type BriefingMacroEmptyCopyLabels = Readonly<{
  macroEmptyCodes: Readonly<Record<string, string>>
  emptyMacro: string
  /** The prefix that turns a reason into a sentence the reader understands, e.g. "暂时读不到：". */
  macroUnreadable: string
  /** 把时刻与时区印进句子里：`{time}` / `{zone}` 由这一版自己的数据截止与读者时区决定。 */
  clock?: Readonly<{ formatTime: (value: string) => string; zoneLabel: string }>
}>

export function briefingMacroEmptyCopy(
  document: Pick<DailyBriefingDocument, 'news' | 'edition'>,
  labels: BriefingMacroEmptyCopyLabels
): BriefingMacroEmptyCopy | null {
  const code = document.news.notes.macroEmpty
  // No note: an edition written before reasons were recorded. Saying nothing is the only honest
  // answer — the sentence would have to invent which of the six reasons applied.
  if (!code) return null
  const reason = labels.macroEmptyCodes[code] ?? labels.emptyMacro
  if (code === 'past-24h-no-high-impact-release') return { sentence: reason, unreadable: false }
  if (code === 'past-24h-high-impact-actuals-pending') {
    const count = document.news.notes.macroEmptyCount
    const clock = labels.clock
    // 数或时刻缺一个就不印：那句话的每个空都是事实，编一个 0 或补一个当下时刻都是新的假话。
    const at = document.edition.dataAsOf ?? document.edition.periodTime ?? document.edition.generatedAt
    if (typeof count === 'number' && clock !== undefined && typeof at === 'string') {
      return {
        sentence: reason
          .replace('{count}', String(count))
          .replace('{time}', clock.formatTime(at))
          .replace('{zone}', clock.zoneLabel),
        unreadable: false,
        pending: true
      }
    }
    // 缺件时退回"读不到"的措辞：宁可说我们没读全，也不替这一版断言事实。
    return { sentence: `${labels.macroUnreadable}${labels.emptyMacro}`, unreadable: true }
  }
  const hours = document.news.notes.macroEmptyHours
  const filled = hours === undefined ? reason : reason.replace('{hours}', String(hours))
  return { sentence: `${labels.macroUnreadable}${filled}`, unreadable: true }
}
