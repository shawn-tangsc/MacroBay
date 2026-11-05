import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import type { JobRunTerminalHookInput } from '../../jobs/runtime/jobRuntime'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { countConsecutiveTerminalFailures, JOB_REPEATED_FAILURE_THRESHOLD } from './jobFailureChain'

/**
 * P2：同一个任务**连续 3 次**终态失败时升级一次（平台需求 v2.4 §1 P2、契约 v2.11 §4.1）。
 *
 * 四条边界：
 *
 * 1. **只在第 3 次那一刻发一次**。第 4、5… 次不再发：读者要的是「它一直坏着」，
 *    而不是每坏一次响一声；同一天同一条（声明里的键带日期），跨天重新计数靠「一次成功清零」。
 * 2. **只通知，不暂停任务**（本版 job runtime 没有暂停机制，文档也写明不做）。
 * 3. **数法从 run 台账取**，见 `countConsecutiveTerminalFailures`：进程重启不清零。
 * 4. **不把原始错误写进通知**：需求 §4 不许出现内部代号、编号、原始错误码；
 *    读者看到的是「先看清楚它在哪出错」，点开去看运行日志。
 */
export type RepeatedTaskFailureNotifierDeps = {
  submit: (request: NotificationSubmitRequest) => Promise<unknown>
  /** 把 definition 解析成给人看的任务名；解析不出返回 `null`（调用方据此不发）。 */
  /** 与 P1 同一个门：只判「这个定义有没有可读名字」，名字本身走引用（见 P1 那段说明）。 */
  hasReadableTaskName: (input: { definitionId: string; productId?: string }) => boolean
  /** 同一任务定义的终态运行，**新到旧**；由装配点从 run 台账取。 */
  listDefinitionRuns: (definitionId: string) => readonly JobRunRecord[]
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」的去重键。 */
  dayToken: (instant: string) => string
}

export function createRepeatedTaskFailureNotifier(deps: RepeatedTaskFailureNotifierDeps) {
  return function notifyRepeatedTaskFailure(input: JobRunTerminalHookInput): Promise<void> {
    if (input.cause !== 'executed' || input.run.status !== 'failed') return Promise.resolve()

    const { run } = input
    // 台账里已经包含这一跑（钩子在 run 写进终态之后触发），所以段长就是含本次的连续失败数。
    const chain = countConsecutiveTerminalFailures(deps.listDefinitionRuns(run.definitionId))
    if (chain !== JOB_REPEATED_FAILURE_THRESHOLD) return Promise.resolve()

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
        // 契约 §3.2：标题/正文/理由键都在 P2 声明里，提交只带参数。
        eventTypeId: 'platform.job.repeated-failed',
        // 归属判定只读 producerId，单位是 **handlerId**：让渡表是 manifest 里的静态表，
        // 只有 handler 稳定；`definitionId` 带期号，每天新一期就是新 id，claim 永远对不上。
        // 去重键仍按「任务定义 + 日期」算——合并是同一件事，让渡是一类任务。
        producerId: run.handlerId,
        dedupeVars: {
          builder: 'template',
          vars: { definitionId: run.definitionId, date: deps.dayToken(completedAt) }
        },
        // 与 P1 同一个引用：同一条作业定义，读的那一刻按语言取名字。
        bodyParams: { taskName: { ref: { scope: 'job-title', definitionId: run.definitionId } } },
        actions: [{ id: 'open-task', labelKey: 'notification.taskFailed.open', kind: 'open', deeplink }],
        deeplink,
        occurredAt: completedAt,
        correlationId: run.id
      })
      .then(() => undefined)
  }
}
