import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'
import { railClock } from './DailyBriefingHistoryRail'
import type { BriefingManualRunOutcome } from './useBriefingManualRun'

/**
 * What the reader is shown after pressing a manual run.
 *
 * The hook decides *whether* the run may start; this decides *what to say* when it may not, and it
 * says the duplicate in the reader's own terms — `日期 · 截止 · 窗口 · 语言` — because "this one
 * already exists" without naming which one leaves them guessing which row the replacement hits.
 *
 * Kept out of the page: the sentence, the label and the replacement are one decision, and a page that
 * assembles them inline is where two callers would drift apart.
 */
export type BriefingManualRunReport = Readonly<{
  outcome: BriefingManualRunOutcome | 'duplicate'
  duplicate?: Readonly<{ label: string; replace: () => void }>
}>

export function briefingManualRunReport(input: Readonly<{
  result: Readonly<{
    outcome: BriefingManualRunOutcome | 'duplicate'
    duplicate?: Readonly<{ periodId: string; asOf: string; windowHours: 12 | 24 | 48; language: DailyBriefingLocale }>
  }>
  text: DailyBriefingText
  timeZone: string
  /**
   * 替换这一版要的输入：期号 + 语言 + **这一次的截止与窗口**。
   *
   * 少了 `generation`，服务就按当前设置跑一遍——读者选了 08:00，替换出来的却是"当前那一版"，
   * 正是被报成「怎么变成重新生成当前版本」的那条错。
   */
  regenerate: (input: Readonly<{
    periodId: string
    locale: DailyBriefingLocale
    generation: Readonly<{ asOf: string; windowHours: 12 | 24 | 48 }>
  }>) => Promise<unknown>
}>): BriefingManualRunReport {
  const { result, text, timeZone, regenerate } = input
  if (result.outcome !== 'duplicate' || result.duplicate === undefined) return { outcome: result.outcome }
  const { periodId, asOf, windowHours, language } = result.duplicate
  const languageName = text.history.editionLanguages[language === 'en-US' ? 'en' : 'zh']
  const label = [asOf.slice(0, 10), railClock(asOf, timeZone), text.history.windowHoursShort.replace('{hours}', String(windowHours)), languageName].join(' · ')
  return {
    outcome: 'duplicate',
    duplicate: { label, replace: () => { void regenerate({ periodId, locale: language, generation: { asOf, windowHours } }) } }
  }
}
