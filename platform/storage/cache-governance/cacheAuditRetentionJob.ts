import type { JobRuntime } from '@platform/jobs'

export const cacheAuditRetentionJobId = 'platform.cacheAuditRetention'

/**
 * 缓存操作审计的保留期任务（`MI-11-R16`）。
 *
 * 这张表原来只增不减，而且**没有任何人在调裁剪**——这正是「写好了没人接」里最不显眼的一种：
 * 函数不存在时谁都看得出来，函数存在但没人定时调，表就会安静地长三年。
 *
 * 传 thunk 而不是实例，理由和通知保留期那条相同：任务注册发生在组合根，而仓储在装配时才构造，
 * 用 thunk 让注册顺序不影响结果，也让用例可以注入假实现。
 */
export type CacheAuditRetentionTarget = Readonly<{
  /** 由 `CacheGovernanceService.pruneAudit` 提供：定时任务拿得到服务，拿不到仓储实例。 */
  pruneAudit: () => Promise<{ removedByAge: number; removedByCount: number }>
}>

export function registerCacheAuditRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{ audit: () => CacheAuditRetentionTarget; timeZone: () => string }>
): void {
  jobRuntime.registerHandler(cacheAuditRetentionJobId, async (_payload, context) => {
    const { removedByAge, removedByCount } = await deps.audit().pruneAudit()
    await context.log({
      level: 'info',
      message: `Cache audit retention: ${removedByAge} record(s) removed by age, ${removedByCount} by count.`
    })
  })

  jobRuntime.setSchedule({
    id: cacheAuditRetentionJobId,
    owner: 'platform',
    handlerId: cacheAuditRetentionJobId,
    // 读者看得懂它在干什么：把超期和超量的缓存审计记录清掉，不是「保留期」这个抽象词。
    title: { 'zh-CN': '清理缓存审计记录', 'en-US': 'Cache audit retention' },
    audience: 'internal' as const,
    // 凌晨跑，避开用户活跃时段；时区取读者时区，和「运行语义跟设置时区」一致。
    trigger: { kind: 'cron', expression: '50 3 * * *', timezone: deps.timeZone() },
    payload: {}
  })
}
