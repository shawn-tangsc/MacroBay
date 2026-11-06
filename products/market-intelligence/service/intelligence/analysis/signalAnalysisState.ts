import type { SignalSeverity } from '../../../contracts/moduleSignal'

/**
 * 「这条信号的分析走到哪一步」——牌子上的字段。
 *
 * 两件事必须分开，因为它们对应两种不同的读者动作：**你关掉了**（去设置打开）、**系统跑出来的
 * 结果**（等它跑完，或者看它为什么没成）。合成一句，读者就不知道该开还是该等。
 *
 * 曾经还有第三个字段「能力是否上线」。扫描接上之后它恒为真，而恒真的字段就是那句永远不会出现
 * 的文案——和「永远不会触发的重试码」「永远为 0 的计数格子」同一种东西，所以连同那句
 * 「自动分析还没上线」一起删掉，不留占位。
 *
 * 状态只从账本来，且只取该 `changeHash` 的最新一行：先被冷却挡下、后来分析成功，显示的是成功
 * 那次，不回退。没有行不等于「没分析」——低档信号按设计永不写行（每个 tick 一行会把读口淹掉），
 * 它必须判成 `skipped` 并给一个固定原因，否则读者会一直等一条永远不会来的分析。
 */
export type SignalAnalysisStateView = Readonly<{
  /** 读者自己在设置里关了自动分析。读设置，不读账本——账本清空后它也不能变。 */
  analysisOffByReader: boolean
  analysisState: 'not-triggered' | 'queued' | 'published' | 'skipped' | 'failed' | 'stopped'
  /**
   * `skipped` / `failed` / `stopped` 必填。
   *
   * 停下来的运行不是失败：读者关窗、被更新的一次取代，都不是「它坏了」。第六态只加一个，
   * 原因分三句：`run-cancelled` / `run-superseded` / `run-unrecognized`。
   */
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
  /** The store's own status union; anything this projection does not know reads as `stopped`. */
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'invalid-output' | 'cancelled' | 'stale' | 'superseded' | string
  failureCode: string | null
}>

export const signalAnalysisStatePolicy = Object.freeze({
  version: 'signalAnalysisState.v1',
  /** The low mark never writes a row, so its reason is a constant rather than a stored code. */
  lowSeverityReason: 'signal-low-marker-only' as const
})

export function projectSignalAnalysisState(input: Readonly<{
  severity: SignalSeverity
  /** The latest row for this change hash, or `undefined` when there is none. */
  row: SignalTriggerLedgerState | undefined
  /** The run the row points at, when it points at one. */
  run: SignalAnalysisRunState | undefined
  analysisOffByReader?: boolean
}>): SignalAnalysisStateView {
  // The setting rides along and is never guessed from the ledger: a read that found no row must not
  // turn "you switched it off" into "the system has not run it". The state is still computed,
  // because a value the renderer hides is cheaper than a sentinel it has to interpret.
  const analysisOffByReader = input.analysisOffByReader ?? false
  const { row, run } = input
  if (!row) {
    // No row is two different facts, and the ordering matters: a low mark is a property of the rule,
    // not a decision that was recorded, so it is judged before "nothing happened yet".
    return input.severity === 'low'
      ? { analysisOffByReader, analysisState: 'skipped', analysisReason: signalAnalysisStatePolicy.lowSeverityReason }
      : { analysisOffByReader, analysisState: 'not-triggered' }
  }
  if (row.decision === 'skipped') {
    return { analysisOffByReader, analysisState: 'skipped', analysisReason: row.reasonCode }
  }
  // 账本行 15 天、运行行 14 天：中间那段时间账本还在、运行已经按年龄清掉了。那时 `run` 取不到，
  // 但这不是「还在排队」——它跑过、记录过期了。说成排队，读者会等一件永远不会再来的事。
  if (!run) {
    return row.analysisRunId
      ? { analysisOffByReader, analysisState: 'stopped', analysisReason: 'run-expired' }
      : { analysisOffByReader, analysisState: 'queued' }
  }
  if (run.status === 'queued' || run.status === 'running') {
    return { analysisOffByReader, analysisState: 'queued' }
  }
  if (run.status === 'succeeded') return { analysisOffByReader, analysisState: 'published' }
  if (run.status === 'queued' || run.status === 'running') return { analysisOffByReader, analysisState: 'queued' }
  if (run.status === 'failed' || run.status === 'invalid-output') {
    return { analysisOffByReader, analysisState: 'failed', analysisReason: run.failureCode ?? undefined }
  }
  // 停下来的运行：不是失败，也不是「还没轮到」。
  if (run.status === 'cancelled') return { analysisOffByReader, analysisState: 'stopped', analysisReason: 'run-cancelled' }
  if (run.status === 'stale' || run.status === 'superseded') {
    return { analysisOffByReader, analysisState: 'stopped', analysisReason: 'run-superseded' }
  }
  // 判定不了就说不出来：不猜成「没成」（诬告），也不猜成「在等」（让人白等）。缺陷由这个码标记。
  return { analysisOffByReader, analysisState: 'stopped', analysisReason: 'run-unrecognized' }
}

/**
 * The state for a whole screenful of signals, keyed by `changeHash`.
 *
 * Deliberately a map **beside** the signals, never a field inside one: a signal is the rule's
 * product, the analysis state is the run's, and a field tucked into `SignalWithWindow` would read as
 * "signals carry their runs" to the next person. One batch, one query, no per-chip lookup.
 */
export function projectSignalAnalysisStates(input: Readonly<{
  /**
   * One record per signal, hash and severity from the same source.
   *
   * Two parallel maps (`changeHashes` + `severities`) could disagree, and the default that covered a
   * missing entry (`?? 'high'`) turned a caller's mistake into "not triggered" on the chip — the
   * reader then waits for an analysis that was never going to come.
   */
  signals: readonly Readonly<{ changeHash: string; severity: SignalSeverity }>[]
  /** Latest ledger row per hash, from the one batch query. */
  rows: readonly SignalTriggerLedgerState[]
  /** The run each row points at, when it points at one. */
  runs: Readonly<Record<string, SignalAnalysisRunState>>
  analysisOffByReader?: boolean
}>): Readonly<Record<string, SignalAnalysisStateView>> {
  const byHash = new Map(input.rows.map(row => [row.changeHash, row]))
  const states: Record<string, SignalAnalysisStateView> = {}
  for (const { changeHash, severity } of input.signals) {
    const row = byHash.get(changeHash)
    states[changeHash] = projectSignalAnalysisState({
      severity,
      row,
      run: row?.analysisRunId ? input.runs[row.analysisRunId] : undefined,
      ...(input.analysisOffByReader === undefined ? {} : { analysisOffByReader: input.analysisOffByReader })
    })
  }
  return states
}
