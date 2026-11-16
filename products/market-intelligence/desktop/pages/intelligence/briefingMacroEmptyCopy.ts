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
  /** The prefix that turns a reason into a sentence the reader understands, e.g. "暂时读不到：". */
  macroUnreadable: string
  /** 「过去 24 小时没有高影响宏观发布」——这一档**正文要印**（用户 2026-11-16 改口径）。 */
  pastWindowNoHighImpact: string
}>

export function briefingMacroEmptyCopy(
  document: Pick<DailyBriefingDocument, 'news'>,
  labels: BriefingMacroEmptyCopyLabels
): BriefingMacroEmptyCopy | null {
  const code = document.news.notes.macroEmpty
  // No note: an edition written before reasons were recorded. Saying nothing is the only honest
  // answer — the sentence would have to invent which of the six reasons applied.
  if (!code) return null
  // 「窗口里真的没有高影响事件」**正文要说一句**（用户 2026-11-16 改口径）：整块消失会让读者
  // 以为功能没了，而这和「确实没有」是两回事。这句话不是「读不到」，所以 `unreadable: false`。
  if (code === 'past-24h-no-high-impact-release') return Object.freeze({ sentence: labels.pastWindowNoHighImpact, unreadable: false })
  // 认不出的原因码：**一句话都不说**（产品 2026-11-06，v2.135）。以前这里回落到
  // 「过去 24 小时没有已发布的高影响事件」——那是把一个"不知道为什么"说成"确实没有"，
  // 而且那句话本身已被禁令删除。说不出来就不说，版面与留痕都不编。
  const reason = labels.macroEmptyCodes[code]
  if (reason === undefined) return null
  const hours = document.news.notes.macroEmptyHours
  const filled = hours === undefined ? reason : reason.replace('{hours}', String(hours))
  return { sentence: `${labels.macroUnreadable}${filled}`, unreadable: true }
}
