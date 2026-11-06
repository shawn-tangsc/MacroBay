import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { ModuleSignalReadFailureCode } from '../../../contracts/moduleSignalRead'
import { projectSignalAnalysisStates, type SignalAnalysisStateView } from './signalAnalysisState'

/**
 * 一屏的信号，连同各自的「分析到哪一步」。
 *
 * 状态与信号**并列**，不塞进信号对象：信号是规则的产物，分析状态是运行的产物；嵌套进去以后，
 * 信号一变读通道就得跟着变，两个人各改一半就会对不上。
 *
 * 三种「没有」在这里就被分开，界面不用猜：
 * - 一条信号都没有 → `available`，空列表（今天真的没事）；
 * - 信号读失败 → `unavailable`（记录没拿到，能重试）；
 * - 某条信号没有账本行 → 它自己那格是 `not-triggered`（还没轮到），不是整批报错。
 */
export type ModuleSignalAnalysisRead =
  | Readonly<{
    state: 'available'
    signals: readonly SignalWithWindow[]
    analysis: Readonly<Record<string, SignalAnalysisStateView>>
    droppedInvalid: number
  }>
  | Readonly<{ state: 'unavailable'; failureCode: ModuleSignalReadFailureCode }>

/** The store surface this needs, kept narrow so a test can hand in plain rows. */
export type SignalAnalysisReadStore = Readonly<{
  listLatestSignalLedgerStates: (changeHashes: readonly string[]) => readonly {
    changeHash: string
    decision: 'queued' | 'skipped' | 'recorded'
    reasonCode: string
    analysisRunId: string | null
  }[]
  getRun: (id: string) => { status: string; failureCode: string | null } | undefined
}>

export function assembleSignalAnalysisRead(input: Readonly<{
  signals: readonly SignalWithWindow[]
  droppedInvalid: number
  store: SignalAnalysisReadStore
  analysisOffByReader?: boolean
}>): ModuleSignalAnalysisRead {
  const hashes = [...new Set(input.signals.map(entry => entry.signal.dedupeKey))]
  const rows = input.store.listLatestSignalLedgerStates(hashes)
  const runs: Record<string, { status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; failureCode: string | null }> = {}
  for (const row of rows) {
    if (!row.analysisRunId) continue
    const run = input.store.getRun(row.analysisRunId)
    if (!run) continue
    // 运行表的状态闭集比这里宽（invalid-output / stale / superseded 等），映射不到的一律当失败：
    // 「跑了但没成」比「还在跑」更接近事实，读者不会一直等。
    runs[row.analysisRunId] = {
      status: run.status === 'succeeded' ? 'succeeded' : run.status === 'queued' || run.status === 'running' ? run.status : 'failed',
      failureCode: run.failureCode
    }
  }
  return {
    state: 'available',
    signals: input.signals,
    analysis: projectSignalAnalysisStates({
      changeHashes: hashes,
      rows,
      runs,
      severities: Object.fromEntries(input.signals.map(entry => [entry.signal.dedupeKey, entry.signal.severity])),
      ...(input.analysisOffByReader === undefined ? {} : { analysisOffByReader: input.analysisOffByReader })
    }),
    droppedInvalid: input.droppedInvalid
  }
}
