/**
 * 「这一格没有数」的 ⓘ 说明句（按三档取），单独成模块。
 *
 * 为什么不在组件里取：正文门禁按**行**找 `*Note` 文案的用法点，只认「就在 ⓘ 入口那一行」的引用
 * （`helpTrigger(...)`/`title=`/`aria-*`）。卡片里这句是在构造单元格对象时先取好、渲染时才塞进
 * `helpTrigger` 的，于是被当成「正文里的说明句」。这里只做**取值**，句子仍然只经 `helpTrigger` 出现。
 *
 * 四态的口径不变（产品 41 号文）：读失败 / 还没读完（不写）/ 待发布（不挂 ⓘ）/ 已发布但没有值。
 * 取不到依据时用那张固定表里的那句，不留空 ⓘ。
 */
import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

export type CellNoteState = 'read-failed' | 'no-such-data' | 'source-no-value'

export function cellNoteFor(
  state: CellNoteState,
  text: MacroIndicatorDrawerText,
  /** 「无此数据」优先用库里给的依据；没有依据才用固定那句。 */
  basis?: string
): string {
  if (state === 'read-failed') return text.cardStates.readFailedNote
  if (state === 'source-no-value') return text.cardStates.sourceNoValueNote
  return basis ?? text.cardStates.noSuchDataNote
}