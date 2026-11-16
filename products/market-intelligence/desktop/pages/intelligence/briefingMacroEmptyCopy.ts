import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/**
 * The one sentence for an empty macro section (`A0.8`), used by "数据缺口与限制".
 *
 * The paper prints nothing for a quiet window (用户 2026-11-16: 正文不印，信息留在问题清单), so this
 * is the only surface that says why the section is empty — and it must distinguish "the window really
 * had no release" (A) from "releases existed but importance filtered them out" (B).
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
  /** 窗口内一条发布都没有：「过去 24 小时没有宏观发布」（用户 2026-11-16，只在问题清单出现）。 */
  pastWindowNoRelease: string
  /** 有发布、但都被重要性筛掉：「过去 24 小时没有高影响宏观发布」。 */
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
  // 「窗口里真的没有」不是「读不到」，所以 `unreadable: false`——问题清单据此给**提示**而不是警告。
  // 两种空窗必须说成两句不同的话（产品 2026-11-16）：窗口里一条都没有时说「没有高影响」，
  // 等于暗示「有低影响被筛掉了」——那是把「没有」说成「筛没了」。
  if (code === 'past-24h-no-release') return Object.freeze({ sentence: labels.pastWindowNoRelease, unreadable: false })
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
