import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import type { JobRunTerminalHookInput } from '../../jobs/runtime/jobRuntime'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createRepeatedTaskFailureNotifier } from './repeatedTaskFailureNotifier'
import { createTaskFailureNotifier } from './taskFailureNotifier'

/**
 * 把「任务失败 → 一条通知」接到调度终态钩子上的**装配胶水**：P1 每次终态失败一条，
 * P2 在第 3 次连续失败那一刻升级一条。
 *
 * 放在这里而不是 `app.ts`：组合根每接一个能力就长几行，而基线只减不增。这段没有窗口、
 * 没有生命周期、没有 Electron，抽出来不牵任何运行期状态，`app.ts` 只留一行调用。
 */
export function wireTaskFailureNotifier(deps: {
  submit: (request: NotificationSubmitRequest) => Promise<unknown>
  /** 任务定义（只用来解析可读任务名）；`run.title` 是标识，绝不使用。 */
  listDefinitions: () => readonly { id: string; title: string }[]
  /**
   * 同一个任务定义的终态运行，**新到旧**。P2 的「连续 3 次」从这里数，不从内存计数器数
   * （重启会清零，坏了两天的任务永远到不了阈值）。取不到就只发 P1：P2 宁可晚一条，
   * 也不要为了它凭空造一个计数。
   */
  listDefinitionRuns: (definitionId: string) => readonly JobRunRecord[]
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」去重。 */
  dayToken: (instant: string) => string
}): (input: JobRunTerminalHookInput) => void {
  const resolveTaskName = ({ definitionId }: { definitionId: string }): string | null =>
    deps.listDefinitions().find((entry) => entry.id === definitionId)?.title ?? null
  const notify = createTaskFailureNotifier({
    submit: deps.submit,
    resolveTaskName,
    dayToken: deps.dayToken
  })
  const notifyRepeated = createRepeatedTaskFailureNotifier({
    submit: deps.submit,
    resolveTaskName,
    listDefinitionRuns: deps.listDefinitionRuns,
    dayToken: deps.dayToken
  })
  // 钩子是同步 void：一次通知失败不能让调度停摆。两条各自独立，一条失败不影响另一条。
  return (input) => {
    void notify(input).catch(() => undefined)
    void notifyRepeated(input).catch(() => undefined)
  }
}
