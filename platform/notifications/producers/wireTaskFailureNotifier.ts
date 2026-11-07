import type { JobTitle } from '../../jobs/runtime/jobTitle'
import { resolveJobTitle } from '../../jobs/runtime/jobTitle'
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
  /** 任务定义（只用来判断有没有可读名字）；`run.title` 是标识，绝不使用。 */
  listDefinitions: () => readonly { id: string; title: JobTitle }[]
  /**
   * 同一个 handler 的终态运行，**新到旧**。P2 的「连续 3 次」从这里数，再按任务身份过滤
   * （一次性作业的 definitionId 每次都不同，按 id 数永远到不了阈值）。取不到就只发 P1：
   * P2 宁可晚一条，也不要为了它凭空造一个计数。
   */
  listHandlerRuns: (handlerId: string) => readonly JobRunRecord[]
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」去重。 */
  dayToken: (instant: string) => string
}): (input: JobRunTerminalHookInput) => void {
  /**
   * 只判「这个名字存在吗」——**不再解析出句子塞进通知**。
   *
   * 名字在通知里以 `{ ref: { scope: 'job-title', definitionId } }` 提交，读的时候由解析端口按
   * 读者语言取（契约 v2.40）。这里再用 `jobTitleText` 取一个英文句子当参数，就是把语言拍死在
   * 提交那一刻——英文界面读出「Task failed: 市场日历 · 经济数据」正是这么来的。
   */
  /**
   * 提交那一刻的作业名，中英两份（契约 v2.49）。
   *
   * 两种语言都取同一份作业定义：`resolveJobTitle` 按语言挑；`{ literal }` 与迁移期的裸字符串
   * 两份相同——那是「读者自己的字不翻译」，不是缺一种语言。
   */
  const taskNameSnapshot = ({ definitionId }: { definitionId: string }) => {
    const title = deps.listDefinitions().find((entry) => entry.id === definitionId)?.title
    if (title === undefined) return undefined
    const zh = resolveJobTitle(title, undefined, 'zh-CN')
    const en = resolveJobTitle(title, undefined, 'en-US')
    if (zh.trim().length === 0 || en.trim().length === 0) return undefined
    return { 'zh-CN': zh, 'en-US': en }
  }
  const notify = createTaskFailureNotifier({
    submit: deps.submit,
    taskNameSnapshot,
    dayToken: deps.dayToken
  })
  const notifyRepeated = createRepeatedTaskFailureNotifier({
    submit: deps.submit,
    taskNameSnapshot,
    listHandlerRuns: deps.listHandlerRuns,
    dayToken: deps.dayToken
  })
  // 钩子是同步 void：一次通知失败不能让调度停摆，也不能让调度等两次落库。
  //
  // **必须串行**：第 3 次连续失败时 P1 与 P2 会在同一次钩子里各提交一条，而 runtime 的
  // `submitEvent` 是「读整份 state → 改 → 整份写回」，没有写串行化。两条同时进去会读到同一份
  // 基线，后写的把先写的记录覆盖掉——S3 要的「两条」会只剩一条。这里等前一条落库后再提后一条。
  return (input) => {
    void notify(input)
      .catch(() => undefined)
      .then(() => notifyRepeated(input))
      .catch(() => undefined)
  }
}
