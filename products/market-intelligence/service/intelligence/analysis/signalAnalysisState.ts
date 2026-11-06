import type { SignalSeverity } from '../../../contracts/moduleSignal'

/**
 * 「这条信号的分析走到哪一步」——牌子上的四个字段。
 *
 * 三件事必须分开，因为它们对应三种不同的读者动作：**我们还没上线**（等发布）、**你关掉了**
 * （去设置打开）、**系统跑出来的结果**（等它跑完，或者看它为什么没成）。合成一句，读者就不知道
 * 该等、该开、还是该重试。
 *
 * 状态只从账本来，且只取该 `changeHash` 的最新一行：先被冷却挡下、后来分析成功，显示的是成功
 * 那次，不回退。没有行不等于「没分析」——低档信号按设计永不写行（每个 tick 一行会把读口淹掉），
 * 它必须判成 `skipped` 并给一个固定原因，否则读者会一直等一条永远不会来的分析。
 */
export type SignalAnalysisStateView = Readonly<{
  /** 能力是否上线。由部署常量决定，不从账本推断。 */
  analysisEnabled: boolean
  /** 读者自己在设置里关了自动分析。读设置，不读账本——账本清空后它也不能变。 */
  analysisOffByReader: boolean
  analysisState: 'not-triggered' | 'queued' | 'published' | 'skipped' | 'failed'
  /** `skipped` / `failed` 必填：两张码表（`signal-*` / `analysis-*`），其余三态不带。 */
  analysisReason?: string
}>

/** One latest ledger row per change hash, as the store returns it. */
export type SignalTriggerLedgerState = Readonly<{
  changeHash: string
  decision: 'queued' | 'skipped' | 'recorded'
  reasonCode: string
  /** Null until the run exists; a queued row without one has not produced anything yet. */
  analysisRunId: string | null
}>

export type SignalAnalysisRunState = Readonly<{
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  failureCode: string | null
}>

export const signalAnalysisStatePolicy = Object.freeze({
  version: 'signalAnalysisState.v1',
  /** The low mark never writes a row, so its reason is a constant rather than a stored code. */
  lowSeverityReason: 'signal-low-display-only' as const,
  /** Wired now that the tick is the one entry that turns signals into runs. */
  analysisEnabled: true
})

export function projectSignalAnalysisState(input: Readonly<{
  severity: SignalSeverity
  /** The latest row for this change hash, or `undefined` when there is none. */
  row: SignalTriggerLedgerState | undefined
  /** The run the row points at, when it points at one. */
  run: SignalAnalysisRunState | undefined
  analysisEnabled?: boolean
  analysisOffByReader?: boolean
}>): SignalAnalysisStateView {
  const analysisEnabled = input.analysisEnabled ?? signalAnalysisStatePolicy.analysisEnabled
  const analysisOffByReader = input.analysisOffByReader ?? false
  // The two capability fields ride along and are never guessed from the ledger: a read that found no
  // row must not turn "you switched it off" into "the system has not run it". The state is still
  // computed, because a value the renderer hides is cheaper than a sentinel it has to interpret.
  const { row, run } = input
  if (!row) {
    // No row is two different facts, and the ordering matters: a low mark is a property of the rule,
    // not a decision that was recorded, so it is judged before "nothing happened yet".
    return input.severity === 'low'
      ? { analysisEnabled, analysisOffByReader, analysisState: 'skipped', analysisReason: signalAnalysisStatePolicy.lowSeverityReason }
      : { analysisEnabled, analysisOffByReader, analysisState: 'not-triggered' }
  }
  if (row.decision === 'skipped') {
    return { analysisEnabled, analysisOffByReader, analysisState: 'skipped', analysisReason: row.reasonCode }
  }
  // `queued` (and `recorded`, which only exists on the evidence side) means something was asked for;
  // whether it arrived is the run's answer, not the ledger's.
  if (!run || run.status === 'queued' || run.status === 'running') {
    return { analysisEnabled, analysisOffByReader, analysisState: 'queued' }
  }
  if (run.status === 'succeeded') return { analysisEnabled, analysisOffByReader, analysisState: 'published' }
  return { analysisEnabled, analysisOffByReader, analysisState: 'failed', analysisReason: run.failureCode ?? undefined }
}
