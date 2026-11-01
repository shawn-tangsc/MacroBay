import type { JobRuntime } from '@platform/jobs'

import type { InUseModelPatrolRuntime } from './inUseModelPatrolRuntime'

export const inUseModelPatrolJobId = 'platform.inUseModelPatrol'

/**
 * 「在用模型」巡检的每日定义。
 *
 * 调度归任务运行时：跨重启不清零（相对 24h 间隔会）、有补跑、有最近一次结果、
 * 在 `listSchedules()` 里可见也可关。handler 第一件事判 readiness——没有可探的模型就
 * 直接返回，不花任何一次请求。
 */
export function registerInUseModelPatrolJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{
    patrol: Pick<InUseModelPatrolRuntime, 'runOnce'>
    /** 至少有一个可探目标才真正发请求；拿不到就说「不跑」。 */
    isReady: () => Promise<boolean>
    isEnabled?: () => Promise<boolean>
  }>
): void {
  jobRuntime.registerHandler(inUseModelPatrolJobId, async (_payload, context) => {
    if (deps.isEnabled && !(await deps.isEnabled())) {
      await context.log({ level: 'info', message: 'In-use model patrol is disabled.' })
      return
    }
    if (!(await deps.isReady())) {
      await context.log({ level: 'info', message: 'No in-use model to patrol.' })
      return
    }
    const retired = await deps.patrol.runOnce()
    await context.log({
      level: 'info',
      message: `In-use model patrol: ${retired.length} retired model(s).`
    })
  })

  jobRuntime.setSchedule({
    id: inUseModelPatrolJobId,
    owner: 'platform',
    handlerId: inUseModelPatrolJobId,
    title: 'In-use model patrol',
    trigger: { kind: 'cron', expression: '30 3 * * *' },
    payload: {}
  })
}
