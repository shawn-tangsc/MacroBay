import { registeredEventNames } from '../../../contracts/indicatorNames'
import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * 日历事件名表跟着**这一版的语言**走，不是界面语言（`02` `A0.9` v2.148）。
 *
 * 名字只有一张表（`contracts/indicatorNames.ts`，中英两列），页面手里那张是**界面语言**的——
 * 界面中文、这一期是英文时直接用它，就把「核心 CPI」印进了英文版。所以：
 * - 版次语言 === 页面语言：用页面传进来的那张（生产里它就是同一张表的对应列）；
 * - 版次语言不同：换成该语言的列，**不回落到界面语言**——回落的代价就是把中文塞进英文版。
 */
export function briefingEventTitles(input: Readonly<{
  pageLocale: DailyBriefingLocale
  editionLocale: DailyBriefingLocale
  pageTitles?: Readonly<Record<string, string>> | undefined
}>): Readonly<Record<string, string>> {
  if (input.editionLocale === input.pageLocale) {
    return input.pageTitles ?? registeredEventNames[input.pageLocale]
  }
  return registeredEventNames[input.editionLocale]
}
