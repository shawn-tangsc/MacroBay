import { MARKET_ANALYSIS_ERROR_CODES, type AnalysisRun } from '../../../contracts/marketAnalysisContracts'

/**
 * 一次运行多久没有终态就算「陈尸」。
 *
 * 运行作业自己的预算 `marketAnalysisJobPolicy.runTimeoutMs` 是 10 分钟，模型调用还有各自的
 * 预算，冻结观察是 45 秒——都远小于这里的 15 分钟。超过它仍停在 `queued` / `running`，就只有
 * 三种可能：进程被挂起或杀掉、调用没回来、作业掉了。三种都不该让读者一直看到「正在生成」。
 */
export const analysisRunStallPolicy = Object.freeze({
  stalledAfterMs: 15 * 60 * 1_000
})

/** 排队里等太久也算：一条排队超过阈值的运行不会再有作业来认领它。 */
export type StallableRun = Pick<AnalysisRun, 'status' | 'queuedAt'> & Readonly<{ startedAt?: string | null }>

export function isStalledAnalysisRun(run: StallableRun, nowIso: string): boolean {
  if (run.status !== 'queued' && run.status !== 'running') return false
  const since = Date.parse(run.startedAt ?? run.queuedAt)
  const now = Date.parse(nowIso)
  return Number.isFinite(since) && Number.isFinite(now) && now - since > analysisRunStallPolicy.stalledAfterMs
}

/**
 * 一条没跑完就断掉的运行：不是模型、不是数据的错，是这条链断在半路。
 * 细码区分「进程停了」与「运行卡住了」——读者能做的事一样（再试一次），事后查证不一样。
 */
export const ANALYSIS_RUN_INTERRUPTED = MARKET_ANALYSIS_ERROR_CODES.runInterrupted
