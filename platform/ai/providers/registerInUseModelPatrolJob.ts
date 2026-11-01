import type { JobRuntime } from '@platform/jobs'

import type { InUseModelPatrolRuntime } from './inUseModelPatrolRuntime'

export const inUseModelPatrolJobId = 'platform.inUseModelPatrol'

/**
 * 「在用模型」巡检的每日定义。
 *
 * 为什么是这个时刻：**用户最少在场、不和交互流量抢**。不是「避开维护窗口」——凌晨恰恰是常见
 * 维护时段，那不是理由。正确性也不靠时刻：只有 `model_retired` / `model_not_found` 两个 code
 * 会进提示，超时、5xx、维护窗口的普通失败都归 `null`，探到可用还会自愈。
 */
export function registerInUseModelPatrolHandler(
  jobRuntime: JobRuntime,
  deps: Readonly<{ patrol: Pick<InUseModelPatrolRuntime, 'runOnce'> }>
): void {
  jobRuntime.registerHandler(inUseModelPatrolJobId, async (_payload, context) => {
    // 第二道闸：调度本来只在有可探目标时存在，这里再确认一次，防止排期与状态短暂错位。
    const retired = await deps.patrol.runOnce()
    await context.log({
      level: 'info',
      message: `In-use model patrol: ${retired.length} retired model(s).`
    })
  })
}

/**
 * 调度跟随启用态：有可探目标就登记，没有就摘掉。
 *
 * 不做「永远登记 + handler 里过滤」——那会让运行态视图天天显示「已排期」，实际每天被挡掉，
 * 用户在界面上既看不出它在空转，也关不掉。
 */
export async function syncInUseModelPatrolSchedule(
  jobRuntime: JobRuntime,
  deps: Readonly<{ isReady: () => Promise<boolean> }>
): Promise<void> {
  if (await deps.isReady()) {
    jobRuntime.setSchedule({
      id: inUseModelPatrolJobId,
      owner: 'platform',
      handlerId: inUseModelPatrolJobId,
      title: 'In-use model patrol',
      trigger: { kind: 'cron', expression: '30 3 * * *' },
      payload: {}
    })
    return
  }
  jobRuntime.removeSchedule(inUseModelPatrolJobId)
}
