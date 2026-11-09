/**
 * 「摘要/上下文卡片没写进会话」的结构化留痕。
 *
 * 会话是记录的附加物，失败不阻断分析或发布；但**不许静默**——读者打开那条 run 会话只会看到
 * 一张卡片，事后只有这条 marker 能查得到。两处调用（卡片、摘要）共用一份，避免各拼一份字段。
 */
export function logAnalysisSessionAppendFailure(
  stage: 'context-card' | 'summary',
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
