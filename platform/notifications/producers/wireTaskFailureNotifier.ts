import type { JobRunTerminalHookInput } from '../../jobs/runtime/jobRuntime'
import type { NotificationRequest } from '../contracts/notificationContracts'
import { createTaskFailureNotifier } from './taskFailureNotifier'

/**
 * 把「任务失败 → 一条通知」接到调度终态钩子上的**装配胶水**。
 *
 * 放在这里而不是 `app.ts`：组合根每接一个能力就长几行，而基线只减不增。这段没有窗口、
 * 没有生命周期、没有 Electron，抽出来不牵任何运行期状态，`app.ts` 只留一行调用。
 */
export function wireTaskFailureNotifier(deps: {
  submit: (request: NotificationRequest) => Promise<unknown>
  /** 任务定义（只用来解析可读任务名）；`run.title` 是标识，绝不使用。 */
  listDefinitions: () => readonly { id: string; title: string }[]
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」去重。 */
  dayToken: (instant: string) => string
}): (input: JobRunTerminalHookInput) => void {
  const notify = createTaskFailureNotifier({
    submit: deps.submit,
    // 过渡期：`titleKey` 还没落地，用 definition.title（模板）；`run.title` 是标识，绝不使用。
    resolveTaskName: ({ definitionId }) =>
      deps.listDefinitions().find((entry) => entry.id === definitionId)?.title ?? null,
    dayToken: deps.dayToken
  })
  // 钩子是同步 void：一次通知失败不能让调度停摆。
  return (input) => { void notify(input).catch(() => undefined) }
}
