import type { JobRuntime } from '@platform/jobs'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import { enqueueIntelligencePipelineJobs } from './enqueueIntelligencePipelineJobs'
import { INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB } from './intelligenceJobIds'

const PRODUCT_ID = 'market-intelligence'

/**
 * 定时回捞：没有新采集时，归一化队列也要自己往前走（0.4.5 #44，用户 2026-11-22 拍板）。
 *
 * 事故（2026-11-22）：归一化只在两种时机触发——应用启动那一次，或该源本次采集真的写进了新
 * 原始记录（`sourceCollectionRun.ts:135` 的 `appended > 0`）。于是「采集全部命中去重」的时段里
 * 队列完全不动：实测 121 条新闻停在 `received`，按每轮 20 条要再启动 6 次才清完，读者不重启就
 * 一直看不到这批新闻，而且没有任何报错。
 *
 * 周期取 10 分钟的理由：一轮最多 20 条新闻（每条要抓正文、可能调模型），10 分钟一轮的上限是
 * 120 条/小时，远高于新闻的产生速度（实测一天 26～32 条）；再密只是空跑与运行记录噪音。
 */
export const RAW_RECORD_RECOVERY_INTERVAL_MS = 10 * 60_000

export function rawRecordRecoveryDefinition(): Readonly<Record<string, unknown>> {
  return {
    id: 'market-intelligence.recover-pending-raw-records',
    owner: 'product' as const,
    productId: PRODUCT_ID,
    handlerId: INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB,
    // 作业名必须双语：运行日志与定时任务页直接显示它，单写英文等于界面上出现内部名。
    title: { 'zh-CN': '补齐待归一化的原始记录', 'en-US': 'Recover pending raw records' },
    audience: 'internal' as const,
    trigger: { kind: 'interval' as const, intervalMs: RAW_RECORD_RECOVERY_INTERVAL_MS, anchor: 'lastComplete' as const },
    payload: {}
  }
}

export function registerRawRecordRecoveryJob(
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'enqueueDefinition'>,
  pipeline: Pick<IntelligencePipeline, 'pendingRawRecordCount' | 'normalizeRawRecords'>
): void {
  jobRuntime.registerHandler(INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB, async (_payload, context) => {
    // 先问一句「有没有活」：队列空时连解析都不进，不抓正文、不花模型调用。
    if (pipeline.pendingRawRecordCount() === 0) return
    const result = await pipeline.normalizeRawRecords({})
    await enqueueIntelligencePipelineJobs(jobRuntime, result.queuedJobs, {
      newItemIds: result.newItemIds,
      ...(result.backfillItemIds.length > 0 ? { backfillItemIds: result.backfillItemIds } : {})
    })
    await context.log({
      level: result.failedCount > 0 || result.staleNewsCount > 0 ? 'warn' : 'info',
      message: `Recovered pending raw records: ${result.processedCount} processed, ${result.failedCount} failed, `
        + `${result.staleNewsCount} news pending over 24h, ${result.staleReceivedCount} records pending over 24h.`
    })
  })
  // 没有调度能力的运行时（测试夹具、纯队列）仍然能注册 handler，只是不会被周期触发。
  if (typeof jobRuntime.setSchedule === 'function') jobRuntime.setSchedule(rawRecordRecoveryDefinition() as never)
}
