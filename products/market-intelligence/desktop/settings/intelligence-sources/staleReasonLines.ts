import type { SourceStaleMeasurements } from '../../../service/intelligence/application/pipelineHealth'
import type { SourceStaleReason } from '../../../service/intelligence/application/sourceStaleness'

/**
 * 「这个源还产出吗」的两句话（用户 2026-11-21：设置里情报源健康那一行要把这两个状态显示出来）。
 *
 * 为什么需要这个模块而不是在行组件里 `if`：两句话各自要一个数字、各自一种病，还要处理
 * 「原因有了但数字读不到」。这段判断放进 JSX，就没人能给它写用例，而它恰好是这次事故的可见面
 * ——采集全绿、两天没产出。文案键来自文案表，这里只做「哪一个原因 → 哪一句 → 填什么数」。
 *
 * 三条口径（都是定过的，改之前先看）：
 * 1. **两句不许合并**：`no-output` 要查源/网络，`normalize-failing` 要查我们的解析；
 *    合成一句，读者永远不知道该查哪边。两个同时为真就两条都显示，不挑一个。
 * 2. 与「采到了但没写进标准表」（`writeFailure`）也是**两件事**：那句说的是值没落库，
 *    这里说的是根本没有条目。各占各的位置，不互相顶替。
 * 3. **原因有、数字没有**时不许显示半句（「这个源已经  小时没有新内容了」），也不编一个数；
 *    走既有的「状态暂时读不到」——读不全就是读不到，不是健康。
 */

export type StaleReasonSource = Readonly<{
  staleReasons?: readonly SourceStaleReason[]
  staleMeasurements?: SourceStaleMeasurements
}>

const reasonKeys: Readonly<Record<SourceStaleReason, string>> = {
  'no-output': 'settings.intelligenceSources.staleReason.no-output',
  'normalize-failing': 'settings.intelligenceSources.staleReason.normalize-failing'
}

const unreadableKey = 'settings.intelligenceSources.health.unknown'

/** 一条原因对应的句子；数字缺失时返回 undefined（由调用方落「状态暂时读不到」）。 */
function lineOf(reason: SourceStaleReason, measurements: SourceStaleMeasurements | undefined, resolveText: (key: string) => string): string | undefined {
  const template = resolveText(reasonKeys[reason])
  if (reason === 'no-output') {
    const hours = measurements?.noOutputHours
    return hours === undefined || !Number.isFinite(hours) ? undefined : template.replace('{hours}', String(hours))
  }
  const count = measurements?.normalizeFailureStreak
  return count === undefined || !Number.isFinite(count) ? undefined : template.replace('{count}', String(count))
}

/**
 * 源行要显示的产出状态句子，按固定顺序（没产出在前——它更靠近读者要做的第一件事）。
 * 空数组 = 没有可报的病（**不是**「健康」的评价，也不额外画一句正常）。
 */
export function staleReasonLines(source: StaleReasonSource, resolveText: (key: string) => string): string[] {
  const reasons = source.staleReasons ?? []
  if (reasons.length === 0) return []
  const lines: string[] = []
  let unreadable = false
  for (const reason of reasons) {
    const line = lineOf(reason, source.staleMeasurements, resolveText)
    if (line === undefined) unreadable = true
    else if (!lines.includes(line)) lines.push(line)
  }
  return unreadable ? [...lines, resolveText(unreadableKey)] : lines
}