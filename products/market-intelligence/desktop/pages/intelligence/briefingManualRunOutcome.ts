import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'
import { railClock } from './DailyBriefingHistoryRail'
import { formattedClock } from './dailyBriefingUnavailableRow'
import type { BriefingRunIntent } from './useBriefingRunActions'
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

/**
 * 手动那次跑起来时，按钮要说清「在写哪一期」：日期、时刻与语言都来自这一次的输入。
 *
 * 缺任何一样就退回「正在重新生成…」的旧说法——宁可不说，也不留一个 `{time}` 空洞。
 * 与提交后的那句说明（本文件的 `briefingManualRunReport`）放在一起：同一个动作的前后两句话，
 * 拆到两个文件就会各自漂移。
 */
export function briefingManualRunningLabel(input: Readonly<{
  intent: BriefingRunIntent | null
  text: DailyBriefingText
  formatTime: (value: string, precision: 'minute') => string
}>): string | undefined {
  const { intent, text } = input
  if (intent?.kind !== 'manual' || intent.asOf === undefined || intent.date === '') return undefined
  const clock = formattedClock(input.formatTime(intent.asOf, 'minute'))
  if (clock === undefined) return undefined
  const date = `${intent.date.slice(5, 7)}/${intent.date.slice(8, 10)}`
  return text.manualRunning
    .replace('{date}', date)
    .replace('{time}', clock)
    .replace('{language}', text.history.languages[intent.locale])
}
