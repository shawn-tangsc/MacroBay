import {
  DEFAULT_PERIOD_ID,
  briefingEditionPeriod,
  isDailyBriefingWindowHours,
  type DailyBriefingDocument,
  type DailyBriefingEditionSummary,
  type DailyBriefingLocale,
  type DailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'
import { briefingEventTitles } from './briefingEventTitles'
import { briefingOnScreenSession } from './briefingOnScreenSession'
import { railClock } from './DailyBriefingHistoryRail'
import { briefingDocument } from './dailyBriefingMode'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 「屏幕上这一版是谁」——页面唯一的身份闸门，连同由它派生出来的那几样（删除目标、重跑那一款、
 * 这一版的事件名表）。
 *
 * 2026-11-16 从页面里整块搬出来：页面要压到 500 行以内，而这十几行推导本来就是同一个问题的答案，
 * 散在页面三处反而更容易各读各的。**只搬不改**——判据、注释、返回形状都照旧。
 */
export function briefingScreenEdition(input: Readonly<{
  view: DailyBriefingPageViewState
  editions: readonly DailyBriefingEditionSummary[]
  todayDate: string
  pinnedDate: string | undefined
  pickedPeriodId: string | undefined
  /** `pickedLocale ?? locale`，由页面算一次后传进来（页面还有别的地方读它）。 */
  effectiveLocale: DailyBriefingLocale
  locale: DailyBriefingLocale
  text: DailyBriefingText
  timeZone: string
  pageEventTitles: Readonly<Record<string, string>> | undefined
}>): Readonly<{
  readyDocument: DailyBriefingDocument | undefined
  selected: Readonly<{ date: string; periodId: string | undefined; locale: DailyBriefingLocale }>
  screenDocument: DailyBriefingDocument | undefined
  deleteTarget: Readonly<{ date: string; clock: string; language: DailyBriefingLocale; periodId: string }> | undefined
  onScreenPeriodId: string
  onScreenSession: Readonly<{ sessionId: string; label: string }> | undefined
  regenerateDay: string | undefined
  screenRerun: Readonly<{ periodTime: string; windowHours?: DailyBriefingWindowHours }> | undefined
  editionEventTitles: Readonly<Record<string, string>>
}> {
  const readyDocument = briefingDocument(input.view)
  /**
   * 读者选中是谁：日期、期号、语言三样。**语言不参与身份比对**（见下）但它决定读哪一份。
   */
  const selected = Object.freeze({
    date: input.pinnedDate ?? input.todayDate,
    periodId: input.pickedPeriodId,
    locale: input.effectiveLocale
  })
  const selectedPeriodIdOnScreen = readyDocument === undefined ? undefined : briefingEditionPeriod(readyDocument.edition).periodId
  /**
   * **唯一一道身份闸门**：文档属于某一版，只有它的身份与选中项一致，它才算"屏幕上这一版"。
   * 正文、右列留痕、删除目标、推送、导出、复制、分享卡全部只读 `screenDocument`——以前它们各读
   * 裸的 `readyDocument`，于是停在 A 上手动生成时，右列还挂着 A 的留痕、导出导出的是 A。
   *
   * **语言不参与比对**：界面要英文而这一期只有中文（语言回退）仍然是同一版，照常显示。
   */
  const documentMatchesSelection = readyDocument !== undefined
    && readyDocument.edition.date === selected.date
    && (selected.periodId === undefined || selectedPeriodIdOnScreen === selected.periodId)
  const screenDocument = documentMatchesSelection ? readyDocument : undefined
  // 当前这一版的身份，交给删除的确认框点名。时刻取这一版自己的名义截止（读者时区），不是"现在"。
  const deleteTarget = screenDocument === undefined ? undefined : (() => {
    const period = briefingEditionPeriod(screenDocument.edition)
    return { date: screenDocument.edition.date, clock: railClock(period.periodTime, input.timeZone), language: screenDocument.edition.locale, periodId: period.periodId }
  })()
  /** 屏幕上这一版的身份：正文里写着的那一期，取不到才退回当前选中/默认期。 */
  const onScreenPeriodId = screenDocument?.edition.periodId ?? input.pickedPeriodId ?? DEFAULT_PERIOD_ID
  /** 屏幕上这一版的会话（E9）；判据与「为空就不渲染」都在 `briefingOnScreenSession` 里。 */
  const onScreenSession = screenDocument && briefingOnScreenSession({
    editions: input.editions, edition: screenDocument.edition, text: input.text, locale: input.locale, timeZone: input.timeZone
  })
  /**
   * 重跑屏幕上这一版时，截止与窗口取它**自己**的（用户 2026-11-06）。
   *
   * 少了这两样，服务端只能回落到期配置列表第一项（初始化那第 1 期的 07:00），于是"点重新生成，
   * 又变成 7 点"，还会在同一个截止上多插一版。没有正文可读时不给（那是"生成这一期"，不是重跑）。
   */
  /** 「重新生成」作用在哪一天：有正文就是这一版；**失败/缺版**的那天没有正文，日期取视图里的（`view.date`）。 */
  const regenerateDay = screenDocument?.edition.date
    ?? (input.view.status === 'no-edition' ? input.view.date : undefined)
  const screenWindowHours = screenDocument?.edition.windowHours
  const screenRerun = screenDocument === undefined ? undefined : {
    periodTime: screenDocument.edition.windowEnd,
    ...(isDailyBriefingWindowHours(screenWindowHours) ? { windowHours: screenWindowHours } : {})
  }
  // 事件名表跟着**这一版的语言**走（`02` `A0.9`）：界面中文 + 英文版次时，界面那张中文名表
  // 会把「核心 CPI」印进英文正文。版次语言与页面语言不同就换表，不回落（回落就是把中文塞进去）。
  const editionEventTitles = briefingEventTitles({
    pageLocale: input.locale,
    editionLocale: screenDocument?.edition.locale ?? input.effectiveLocale,
    pageTitles: input.pageEventTitles
  })

  return { readyDocument, selected, screenDocument, deleteTarget, onScreenPeriodId, onScreenSession, regenerateDay, screenRerun, editionEventTitles }
}
