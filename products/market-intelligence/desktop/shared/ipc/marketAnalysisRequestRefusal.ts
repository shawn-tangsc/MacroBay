/**
 * 手动分析请求被拒的归因（渲染层）。
 *
 * 每个能行动的原因一句，表外落兜底；**原始错误一定要留在 `app.log`**：主进程的 `console`
 * 不进日志，只有渲染层的 warn 会。2026-11-20 那次就是靠这行才查到
 * `analysis-missing-evidence:news-trigger-evidence-missing`。
 */
export type AnalysisRequestRefusal =
  | 'not-eligible' | 'not-ready' | 'provider-not-ready' | 'insufficient-evidence' | 'already-available' | 'failed'

export function describeRequestRefusal(error: unknown, path: string): AnalysisRequestRefusal {
  const message = error instanceof Error ? error.message : String(error)
  // The main process' refusals are answers, not failures: it says this when a usable analysis
  // already exists, including the run it just completed.
  if (message.includes('analysis-already-available')) return 'already-available'
  // The main process answers this before its runtime is wired, which is exactly what a click
  // during a restart hits. Naming it keeps the panel from blaming the model configuration.
  if (message.includes('analysis-initial-request-unavailable')) return 'not-ready'
  // 没有可用模型：一次冻结都没排。它既不是「服务还没起来」，也不是「排不上队」。
  if (message.includes('analysis-provider-not-ready')) return 'provider-not-ready'
  // 证据建不出来（多因原始记录已不在保留期）：重试不会自己好，读者要做的是换一条最新内容。
  if (message.includes('analysis-missing-evidence')) {
    console.warn('[mi-analysis-request-refused]', JSON.stringify({ reason: 'missing-evidence', message, path }))
    return 'insufficient-evidence'
  }
  // 表外的码也留原始 name/message：不把「为什么」丢在这一层。
  console.warn('[mi-analysis-request-refused]', JSON.stringify({
    reason: 'unmapped', name: error instanceof Error ? error.name : 'unknown', message, path
  }))
  return message === 'analysis-not-eligible' ? 'not-eligible' : 'failed'
}
