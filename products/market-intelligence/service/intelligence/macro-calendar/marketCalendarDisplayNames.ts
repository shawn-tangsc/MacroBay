import { metricConceptOf } from '../../../contracts/metricKeyConcept'
import { POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS } from '../../../contracts/policyPath'
import { marketCalendarEventTypeDisplayNames, marketCalendarMetricDisplayNames } from './marketCalendarDisplayNameTables'

/**
 * 两张**纯展示**表：指标名（键 = `metric_key`）与源类型名（键 = 源给的类型串）。
 *
 * 数据本体在 `marketCalendarDisplayNameTables.ts`（数据与逻辑分开：结构性守卫要断言逻辑文件里
 * 没有抄第二份优先顺序，而数据行里当然有那些 key——分开才不互相打架）。
 *
 * **纪律（写死）**：
 * - 只做展示：**永不参与身份、永不参与曲线标注资格**。判身份看写入时定下的 `candidate_key`，
 *   判标注看四个 `metric_key` 与两个 `series_id`；这两张表不许进那条链。
 * - 表里只有指标名与源类型名，**不许出现个体名**（讲话人、具体会议名）。
 * - 只增不改：改一个名字等于改读者看到的历史认知，要单独提一笔并写理由。
 * - 未知键**回退英文原文**并计数（计数只进日志，不上界面）。
 * - 只提供中文；英文界面直接用源给的英文名，所以这里没有 `en` 列。
 */



/** 未知键的计数：**只给日志与排期看，不许上界面**。 */
const unknownDisplayNames = { metricKeys: 0, eventTypes: 0 }

export function marketCalendarDisplayNameTally(): Readonly<{ metricKeys: number; eventTypes: number }> {
  return { ...unknownDisplayNames }
}

/**
 * 一个事件的展示标题。三条顺序，缺一条就退一位，最后一定退到源给的原文：
 * 1. 有 `eventNameKey` → 指标名表（这是「这一行是哪条指标」的规范叫法）；
 * 2. 否则按源给的标题去类型名表（讲话/报告这类）；
 * 3. 都没有 → 源原文（英文），并计数。**不翻译、不猜、不按相似度找。**
 */
export function marketCalendarDisplayTitle(input: Readonly<{
  rawTitle: string; eventNameKey: string | undefined; measureKeys?: readonly string[]
  locale: 'zh' | 'en'
}>): string {
  if (input.locale !== 'zh') return input.rawTitle
  // 一次发布覆盖多个指标时，标题取**契约里那份优先顺序**里第一个有中文名的——顺序只有一份，
  // 这里不另写（写了就会和标注归组那份漂开，同一件事两个界面叫两个名字）。
  // 顺序按**概念**排（M4）：先把每个 measure 归一到概念再比，季调/未季调两种码都能命中。
  for (const concept of POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS) {
    const key = input.measureKeys?.find((candidate) => metricConceptOf(candidate) === concept)
    if (key === undefined) continue
    const named = marketCalendarMetricDisplayNames[key]
    if (named !== undefined) return named
  }
  if (input.eventNameKey !== undefined) {
    const named = marketCalendarMetricDisplayNames[input.eventNameKey]
    if (named !== undefined) return named
    unknownDisplayNames.metricKeys += 1
  }
  const typed = marketCalendarEventTypeDisplayNames[input.rawTitle]
  if (typed !== undefined) return typed
  unknownDisplayNames.eventTypes += 1
  return input.rawTitle
}
