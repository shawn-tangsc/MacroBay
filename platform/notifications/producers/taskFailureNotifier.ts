import type { JobRunTerminalHookInput } from '../../jobs/runtime/jobRuntime'
import type { NotificationRequest } from '../contracts/notificationContracts'

/**
 * 第一个真实通知来源：**任务最终失败**。
 *
 * 三条边界，都来自今晚的裁定：
 *
 * 1. **只有 `executed` 且 `failed` 才发**。`rejected`（排队被取消/超时/关机拒绝）不是任务出错，
 *    `recovered`（上个进程遗留的结清）属于历史——把这三类都当失败，用户会在重启后收到一条
 *    「你的任务失败了」，而他什么都没做错。成功不发：顺利的一天应该是 0 条。
 * 2. **标题取任务的人话名，绝不退回 `run.title`**。`run.title` 是任务标识（`Collect 央行`、
 *    `market:cn-holiday`），原样贴到界面不是人话；解析不出可读名字时**宁可不发**。
 * 3. **去重键 = 同一任务 + 同一天**（读者时区的「一天」，由调用方注入 `dayToken`）。
 *    同一个任务一天失败三次只该有一条通知，而三次的 `occurrenceCount` 会记成 3。
 *
 * 这个模块不认识 Electron，也不读设置：语言、任务名解析、时区日界都由装配点注入，
 * 所以它可以被直接测，且平台模块之间不必互相 import。
 */
export type TaskFailureNotifierDeps = {
  submit: (request: NotificationRequest) => Promise<unknown>
  /** 把 definition 解析成给人看的任务名；解析不出返回 `null`（调用方据此不发）。 */
  resolveTaskName: (input: { definitionId: string; productId?: string }) => string | null
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」去重。 */
  dayToken: (instant: string) => string
  /** 单条失败原因的截断长度；默认 160，避免把堆栈整段塞进通知。 */
  maxReasonLength?: number
}

const DEFAULT_MAX_REASON_LENGTH = 160

export function createTaskFailureNotifier(deps: TaskFailureNotifierDeps) {
  return function notifyTaskFailure(input: JobRunTerminalHookInput): Promise<void> {
    if (input.cause !== 'executed' || input.run.status !== 'failed') return Promise.resolve()

    const { run } = input
    const taskName = deps.resolveTaskName({ definitionId: run.definitionId, productId: run.productId })
    if (taskName === null || taskName.trim() === '') return Promise.resolve()

    const completedAt = run.completedAt ?? run.startedAt ?? run.createdAt
    const reason = truncate(run.lastError?.trim() || '', deps.maxReasonLength ?? DEFAULT_MAX_REASON_LENGTH)
    const deeplink = {
      scope: run.owner === 'product' ? ('product' as const) : ('platform' as const),
      ...(run.productId === undefined ? {} : { productId: run.productId }),
      settingsSectionId: 'task-automation',
      entityType: 'job-definition',
      entityId: run.definitionId
    }

    return deps.submit({
      owner: run.owner,
      ...(run.productId === undefined ? {} : { productId: run.productId }),
      sourceId: `job-run-failed:${run.definitionId}`,
      // 记录里**只存键与参数**：句子由解析器按读者语言产出，切语言时历史通知跟着变。
      titleKey: 'notification.taskFailed.title',
      titleParams: { taskName },
      ...(reason === '' ? {} : { bodyKey: 'notification.taskFailed.body' }),
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center', 'desktop'],
      actions: [{ id: 'open-task', labelKey: 'notification.taskFailed.open', kind: 'open', deeplink }],
      deeplink,
      dedupeKey: `task-failed:${run.definitionId}:${deps.dayToken(completedAt)}`,
      correlationId: run.id
    }).then(() => undefined)
  }
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1))}…`
}
