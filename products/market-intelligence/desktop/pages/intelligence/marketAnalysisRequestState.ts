/**
 * 一次分析请求的状态与「失败在哪」。
 *
 * 单独一份，因为请求状态机（`marketAnalysisRequestRunner`）与 hook 都要读它；类型住在 hook 里会让
 * 模块反向依赖 hook，循环一旦形成，下一次改动只能靠猜。
 */
export type AnalysisRequestState = 'idle' | 'loading' | 'queued' | 'still-running' | 'unavailable' | 'not-ready' | 'provider-not-ready' | 'insufficient-evidence' | 'failed' | 'already-available'

/**
 * Where a failed request failed.
 *
 * A refusal before a run exists ("the service said no") and a run that finished without
 * publishing are different failures, and rendering both as "the request did not go through"
 * told the reader nothing about the analysis they had just asked for.
 */
export type AnalysisRequestFailure = 'request' | 'run'
