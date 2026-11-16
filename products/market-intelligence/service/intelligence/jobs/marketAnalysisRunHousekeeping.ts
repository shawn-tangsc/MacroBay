import type { JobContext, JobRuntime } from '@platform/jobs'

import type { AnalysisRunService } from '../analysis/analysisRunService'
import { RUN_MARKET_ANALYSIS_JOB } from './marketAnalysisJobIds'

/**
 * 运行的家务：重启对账与周期性收尸。
 *
 * 两件事同属一条不变量——**运行不许无声挂死**：重启后不可能还有代码在跑，判「被打断」；
 * 进程活着但调用/作业没了，由周期清点判「卡住」。放在这里是因为装配文件已经到体积基线，
 * 而这段语义完整、可以单独读。
 */
export function createAnalysisRunHousekeeping(deps: Readonly<{
  isEnabled: () => Promise<boolean>
  runs: Pick<AnalysisRunService, 'recover' | 'sweepStalled'>
  jobRuntime: Pick<JobRuntime, 'listRuns'>
}>): Readonly<{
  recoverRuns: (payload: unknown, context: JobContext) => Promise<Readonly<{ dispatch: readonly { analysisRunId: string; eventGroupId: string }[] }> | void>
  sweepStalledRuns: (payload: unknown, context: JobContext) => Promise<Readonly<{ stalled: readonly string[] }> | void>
}> {
  return {
    recoverRuns: async (_payload, context) => {
      if (!await deps.isEnabled()) return
      const recovery = deps.runs.recover()
      // The service can only write rows; this is the only place that can hand a recovered
      // run to the job runtime, and the freeze path is not available to it (recovery
      // analyses a snapshot that already exists, so there is nothing to freeze). A run
      // that still has a live job is left alone: dispatching it twice would make the
      // second run job fail on `claimRun`.
      const dispatch = recovery.dispatch.filter(run => deps.jobRuntime.listRuns({
        handlerId: RUN_MARKET_ANALYSIS_JOB,
        statuses: ['queued', 'running'],
        payload: { analysisRunId: run.analysisRunId },
        limit: 1
      }).length === 0)
      await context.log({
        level: 'info',
        message: `Recovered ${recovery.failed.length} market analysis run(s); expired ${recovery.stale.length}; dispatching ${dispatch.length}.`,
        metadata: { failed: recovery.failed.length, stale: recovery.stale.length, dispatching: dispatch.length }
      })
      return { dispatch }
    },
    sweepStalledRuns: async (_payload, context) => {
      if (!await deps.isEnabled()) return
      const stalled = deps.runs.sweepStalled()
      // 一条都不必写日志噪音；有陈尸时必须留下痕迹——「跑了两分钟什么都没给」正是没有痕迹的那次。
      if (stalled.length === 0) return
      await context.log({
        level: 'warn',
        message: `Interrupted ${stalled.length} stalled market analysis run(s).`,
        metadata: { analysisRunIds: stalled }
      })
      return { stalled }
    }
  }
}
