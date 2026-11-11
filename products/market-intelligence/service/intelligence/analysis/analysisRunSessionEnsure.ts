import { logAnalysisSessionAppendFailure } from './analysisSessionAppendFailure'

/**
 * 给这一次运行建会话：**失败不阻断分析，但绝不静默**（F1 / 架构师 2026-11-10 条件）。
 *
 * 会话是记录的附加物——读者打开那条 run 会话看这次问了什么、答了什么。它建不出来时分析照跑，
 * 可是事后能查的只有一条 marker：窄查抛错（同一个 ref 命中两条，按设计就是抛）或 create 失败，
 * 以前落进一个空的 `catch`，运行一条会话都没有、日志也干净。
 *
 * 抽在这里而不是留在编排器里：编排器已经顶到体积门禁的线，这段有自己的一条判据，单独成文件
 * 才说得清「哪条路径没有会话」。
 */
export async function ensureAnalysisRunSession(input: Readonly<{
  runId: string
  queuedAt: string
  ensure?: (input: Readonly<{ runId: string; queuedAt: string }>) => Promise<string | undefined>
}>): Promise<void> {
  if (!input.ensure) {
    // 端口没接时以前一声不响：运行照跑、会话一条没有、日志干净。
    logAnalysisSessionAppendFailure('ensure', input.runId, 'session-port-missing')
    return
  }
  try {
    await input.ensure({ runId: input.runId, queuedAt: input.queuedAt })
  } catch (error) {
    logAnalysisSessionAppendFailure('ensure', input.runId, error)
  }
}

/**
 * 把已发布摘要追加到那次运行的会话：失败不阻断发布，但**不留静默出口**。
 *
 * 摘要没进会话时，读者打开那条 run 会话只会看到一张卡片；这条 marker 是事后唯一能查到
 * 「勾上了发布、却没进会话」的证据。
 */
export async function appendAnalysisRunSessionSummary(input: Readonly<{
  runId: string
  summary: string
  append?: (input: Readonly<{ runId: string; summary: string }>) => Promise<void>
}>): Promise<void> {
  if (!input.append || input.summary.length === 0) return
  try {
    await input.append({ runId: input.runId, summary: input.summary })
  } catch (error) {
    logAnalysisSessionAppendFailure('summary', input.runId, error)
  }
}
