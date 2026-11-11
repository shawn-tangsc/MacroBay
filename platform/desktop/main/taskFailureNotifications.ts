import type { JobRunTerminalHookInput } from '@platform/jobs'

import { wireTaskFailureNotifier } from '../../notifications/producers/wireTaskFailureNotifier'

type NotifierDeps = Parameters<typeof wireTaskFailureNotifier>[0]

/**
 * 「任务最终失败 → 通知」这条生产者的接线（从 `app.ts` 抽出来，见 `029c0fe` 的先例）：
 * 通知语义不进受保护的装配接缝，`app.ts` 只留一行组装。
 *
 * 三处细节留在这里，不跟着调用点走：
 * - **连续 3 次失败按任务身份数**：一次性作业每次 definitionId 都带时间戳与随机后缀，按
 *   definitionId 数永远到不了阈值（同一个人工任务失败 5 次会变成 5 条各自独立的通知）；
 *   身份过滤在生产者里做（周期作业 = definitionId，一次性作业 = handler + sourceId）。
 * - `listHandlerRuns` 取回该 handler 的运行序列，`limit: 200` 给「同一 handler 多来源交错」留余量。
 * - `dayToken` 用**设置时区**切天（和读者看到的「今天」同一口径）。
 */
export function createTaskFailureNotifier(input: Readonly<{
  submit: NotifierDeps['submit']
  listDefinitions: NotifierDeps['listDefinitions']
  listHandlerRuns: NotifierDeps['listHandlerRuns']
  timeZone: () => string
}>): (terminal: JobRunTerminalHookInput) => void {
  return wireTaskFailureNotifier({
    submit: input.submit,
    listDefinitions: input.listDefinitions,
    listHandlerRuns: input.listHandlerRuns,
    dayToken: (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone() }).format(new Date(instant))
  })
}
