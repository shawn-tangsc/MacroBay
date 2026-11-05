import type { JobRunTerminalHookInput } from '../../jobs/runtime/jobRuntime'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'

/**
 * P1：任务跑到终态仍失败时记一条（平台需求 v2.4 §1 P1、契约 v2.11 §3.2）。
 *
 * 三条边界，都来自冻结文档：
 *
 * 1. **只有 `executed` 且 `failed` 才发**。`rejected`（排队被取消/超时/关机拒绝）不是任务出错，
 *    `recovered`（上个进程遗留的结清）属于历史——把这三类都当失败，用户会在重启后收到一条
 *    「你的任务失败了」，而他什么都没做错。成功不发：顺利的一天应该是 0 条。
 * 2. **标题取任务的人话名，绝不退回 `run.title`**。`run.title` 是任务标识（`Collect 央行`、
 *    `market:cn-holiday`），原样贴到界面不是人话；定义不存在或没有可读名字时**宁可不发**。
 *    名字本身**不以字面量提交**：传的是 `{ ref: { scope: 'job-title', definitionId } }`，由解析端口
 *    在**读的那一刻**按读者语言取（契约 v2.40）——提交时根本不知道读者语言，一按死就翻不回来了。
 * 3. **去重键 = 同一任务 + 同一天**（读者时区的「一天」，由调用方注入 `dayToken`）。
 *    同一个任务一天失败三次只该有一条通知，而三次的 `occurrenceCount` 会记成 3。
 *    **中间重试不发**：重试是同一跑内的 attempt 循环，终态钩子只通报一次。
 *
 * 原始错误**不进通知**（需求 §4 不许出现内部代号、编号、原始错误码）：读者点开去看运行日志。
 *
 * 这个模块不认识 Electron，也不读设置：语言、任务名解析、时区日界都由装配点注入，
 * 所以它可以被直接测，且平台模块之间不必互相 import。
 */
export type TaskFailureNotifierDeps = {
  submit: (request: NotificationSubmitRequest) => Promise<unknown>
  /**
   * 这个定义有没有可读的任务名。**只用来决定发不发**：名字本身走引用，在读的那一刻按语言取，
   * 不在这里取一次再塞进参数——那就是把语言拍死在提交时。
   */
  hasReadableTaskName: (input: { definitionId: string; productId?: string }) => boolean
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」去重。 */
  dayToken: (instant: string) => string
}

export function createTaskFailureNotifier(deps: TaskFailureNotifierDeps) {
  return function notifyTaskFailure(input: JobRunTerminalHookInput): Promise<void> {
    if (input.cause !== 'executed' || input.run.status !== 'failed') return Promise.resolve()

    const { run } = input
    if (!deps.hasReadableTaskName({ definitionId: run.definitionId, productId: run.productId })) {
      return Promise.resolve()
    }

    const completedAt = run.completedAt ?? run.startedAt ?? run.createdAt
    const deeplink = {
      scope: run.owner === 'product' ? ('product' as const) : ('platform' as const),
      ...(run.productId === undefined ? {} : { productId: run.productId }),
      settingsSectionId: 'task-automation',
      entityType: 'job-definition',
      entityId: run.definitionId
    }

    return deps
      .submit({
        // 契约 §3.2：键来自声明，提交只带参数。标题/正文键在 P1 声明里。
        eventTypeId: 'platform.job.failed-terminal',
        // 归属判定只读 producerId，单位是 **handlerId**：让渡表是 manifest 里的静态表，
        // 只有 handler 稳定；`definitionId` 带期号，每天新一期就冒出一个新 id，claim 永远对不上。
        // 一类任务共用一个 handler 不是问题——claim 的单位就是 handler。平台自有任务视为已登记。
        producerId: run.handlerId,
        dedupeVars: {
          builder: 'template',
          vars: { definitionId: run.definitionId, date: deps.dayToken(completedAt) }
        },
        // 作业名以引用提交：存的是「哪一条作业定义」，句子读的那一刻才按语言生成。
        titleParams: { taskName: { ref: { scope: 'job-title', definitionId: run.definitionId } } },
        actions: [{ id: 'open-task', labelKey: 'notification.taskFailed.open', kind: 'open', deeplink }],
        deeplink,
        occurredAt: completedAt,
        correlationId: run.id
      })
      .then(() => undefined)
  }
}
