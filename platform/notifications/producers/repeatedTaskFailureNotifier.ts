import type { JobRunRecord } from '../../jobs/contracts/jobTypes'
import type { JobRunTerminalHookInput } from '../../jobs/runtime/jobRuntime'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { countConsecutiveTerminalFailures, JOB_REPEATED_FAILURE_THRESHOLD } from './jobFailureChain'
import { jobFailureIdentityOf } from './jobFailureIdentity'
import { renderPlatformEventCopy } from './platformEventCopy'

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
  /** 与 P1 同一个源：作业名的**中英两份快照**（契约 v2.49），取不到就不发。 */
  taskNameSnapshot: (input: { definitionId: string; productId?: string }) =>
    { 'zh-CN': string; 'en-US': string } | undefined
  /** 同一 handler 的终态运行，**新到旧**；由装配点从 run 台账取，再按身份过滤。 */
  listHandlerRuns: (handlerId: string) => readonly JobRunRecord[]
  /** 读者时区的一天（`YYYY-MM-DD`），用于「同任务 + 同一天」的去重键。 */
  dayToken: (instant: string) => string
}

export function createRepeatedTaskFailureNotifier(deps: RepeatedTaskFailureNotifierDeps) {
  return function notifyRepeatedTaskFailure(input: JobRunTerminalHookInput): Promise<void> {
    if (input.cause !== 'executed' || input.run.status !== 'failed') return Promise.resolve()

    const { run } = input
    const identity = jobFailureIdentityOf(run)
    // 台账里已经包含这一跑（钩子在 run 写进终态之后触发），所以段长就是含本次的连续失败数。
    // 按**身份**数而不是按 definitionId：一次性作业每次 id 都不同，按 id 数永远到不了 3。
    const chain = countConsecutiveTerminalFailures(deps.listHandlerRuns(run.handlerId), identity)
    if (chain !== JOB_REPEATED_FAILURE_THRESHOLD) return Promise.resolve()

    const taskName = deps.taskNameSnapshot({ definitionId: run.definitionId, productId: run.productId })
    if (taskName === undefined) return Promise.resolve()

    const completedAt = run.completedAt ?? run.startedAt ?? run.createdAt
    // 源头拼成品（契约 v2.56）：与 P1 同一份双语快照，两种语言各拼一份。
    const rendered = renderPlatformEventCopy({
      eventTypeId: 'platform.job.repeated-failed',
      paramsByLanguage: { 'zh-CN': { taskName: taskName['zh-CN'] }, 'en-US': { taskName: taskName['en-US'] } }
    })
    if (rendered === undefined) return Promise.resolve()
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
          vars: { jobKey: identity, date: deps.dayToken(completedAt) }
        },
        rendered,
        actions: [{ id: 'open-task', labelKey: 'notification.taskFailed.open', kind: 'open', deeplink }],
        deeplink,
        occurredAt: completedAt,
        correlationId: run.id
      })
      .then(() => undefined)
  }
}
