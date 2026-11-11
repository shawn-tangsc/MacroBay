/**
 * 「这次运行没有可看的会话」的结构化留痕（F1 / 架构师 2026-11-10 条件）。
 *
 * 会话是记录的附加物，失败不阻断分析或发布；但**不许静默**——读者打开那条 run 会话只会看到
 * 一张卡片，事后只有这条 marker 能查得到。四个出口共用一份，避免各拼一份字段：
 *
 * - `context-card` / `summary`：写卡片、写摘要那一步抛了；
 * - `ensure`：这次运行根本没有会话，或端口没接；`session-missing`：发布时窄查找不到它。
 */
export function logAnalysisSessionAppendFailure(
  stage: 'context-card' | 'summary' | 'ensure' | 'session-missing',
  runId: string,
  error: unknown
): void {
  console.log(JSON.stringify({
    marker: 'MI_ANALYSIS_RUN_SESSION_APPEND_FAILED',
    stage,
    runId,
    reason: error instanceof Error ? error.message : String(error)
  }))
}
