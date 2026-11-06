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
  /** One query for every run the batch points at; a missing id simply does not appear. */
  getRunsByIds: (ids: readonly string[]) => Readonly<Record<string, { status: string; failureCode: string | null }>>
}>

export function assembleSignalAnalysisRead(input: Readonly<{
  signals: readonly SignalWithWindow[]
  droppedInvalid: number
  store: SignalAnalysisReadStore
  analysisOffByReader?: boolean
}>): ModuleSignalAnalysisRead {
  const hashes = [...new Set(input.signals.map(entry => entry.signal.dedupeKey))]
  const rows = input.store.listLatestSignalLedgerStates(hashes)
  // 整屏两次查询：账本一次、运行一次。按行查会把一屏 30 条变成 31 次。
  // 取不到的 id 不进 map——那是「运行记录已过保存期」，由投影判成 stopped，不是还在排队。
  const runs = input.store.getRunsByIds(rows.flatMap(row => row.analysisRunId ? [row.analysisRunId] : []))
  return {
    state: 'available',
    signals: input.signals,
    analysis: projectSignalAnalysisStates({
      signals: input.signals.map(entry => ({ changeHash: entry.signal.dedupeKey, severity: entry.signal.severity })),
      rows,
      runs,
      ...(input.analysisOffByReader === undefined ? {} : { analysisOffByReader: input.analysisOffByReader })
    }),
    droppedInvalid: input.droppedInvalid
  }
}
