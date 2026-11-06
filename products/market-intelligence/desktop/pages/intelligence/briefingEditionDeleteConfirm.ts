import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 删除**这一版**（某一期的某一种语言）时，两个入口共用的那一句话。
 *
 * 入口有两个——正文顶部工具栏的第五颗、行上的右键菜单——但删的是同一件事，所以文案与确认框
 * 只在这里生成一次。两个入口各写一套的后果不是"多写几行"，而是两条路径慢慢说出不同的句子，
 * 读者分不清哪一句才是真的。
 *
 * 标题必须点名 `日期 · 时刻 · 语言`：只说"删除？"的话，读者在按下确认键之前没法确认删的是哪一版。
 * 时刻可能没有（还没有生成过的那一行），那就只点名日期与语言——空着一段比写一个假时刻好。
 */
export type BriefingEditionDeleteTarget = Readonly<{
  date: string
  /** The row's own clock in the reader's zone; absent when this edition never had one. */
  clock?: string
  language: DailyBriefingLocale
}>

export function briefingEditionDeleteCopy(text: DailyBriefingText, target: BriefingEditionDeleteTarget): Readonly<{
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
}> {
  const language = text.history.editionLanguages[target.language === 'en-US' ? 'en' : 'zh']
  const named = [target.date, target.clock, language].filter((part): part is string => part !== undefined && part !== '').join(' · ')
  return {
    title: text.history.deleteEditionTitle.replace('{target}', named),
    description: text.history.deleteEditionDescription,
    // 确认键点名对象：两个弹窗都写「删除」的话，读者只能回头看标题，而手指已经落下了。
    confirmLabel: text.history.deleteEditionConfirm,
    cancelLabel: text.history.deleteCancel
  }
}
