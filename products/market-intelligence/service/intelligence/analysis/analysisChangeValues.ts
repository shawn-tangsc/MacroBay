import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { numbersIn } from './analysisPrintedNumbers'
import { analysisModelVocabulary } from './analysisModelVocabulary'
import type { SnapshotChange } from '../../../contracts/marketAnalysisContracts'
import { isUnchangedSnapshot, printedChangeValuePairs } from './snapshotChange'

/**
 * 「变更摘要里印给模型看过的那些百分数」——正文数字出处规则的**第二个集合**。
 *
 * 三条硬边界（架构师 2026-11-11）：
 * 1. **从值位的渲染文本里取**（`printedChangeValuePairs`），不从 `SnapshotChange` 的原始 before 值取：
 *    模型看的是摘要那两串，不是结构体；同一 formatter、同一语言，抓的才是它真的见过的数。
 *    摘要里的行文数字（「24 小时」「3 条」）不收——那等于给编造开口子。
 * 2. **不越过截断**：`maximumFactChanges` 是 200，第 201 条根本没印出来——从渲染文本取数天然满足这条，
 *    所以这里不需要、也不许自己去翻快照历史。
 * 3. **只当「有没有出处」用**：它不参与背离配对、触发器焦点或 `hasKnownReferences`；本函数只回落成
 *    一个数字数组交给那条规则。
 *
 * 匹配语义也不放宽：变更值仍走等值/整数取整（`tracedToSnapshot`），不走概率那条整数约数
 * （`tracedToProbability`）——约数口径只属于「概率」这个语义，不许沿着变更值扩散。
 */
export function changeValuesForPrompt(
  change: SnapshotChange | undefined,
  language: AppLanguage
): readonly number[] | undefined {
  if (change === undefined || isUnchangedSnapshot(change)) return undefined
  // **只读到值位**：普通数字与百分数都取，但摘要里那些行文数字（24 小时、3 条）不进集合。
  const values = [...new Set(printedChangeValuePairs(change, analysisModelVocabulary, language).flatMap(numbersIn))]
  return values.length === 0 ? undefined : values
}
