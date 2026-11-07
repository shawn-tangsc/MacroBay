import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import type { CapitalConditionsSnapshotResult } from '../../../contracts/intelligenceQueryContracts'
import { isCanonicalSignalTime } from '../../../contracts/moduleSignal'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { MacroRouteQuery } from '../public-query/macroRouteQuery'
import { normalizeMacroRouteMonths, queryMacroRoute } from '../public-query/macroRouteQuery'
import { createCalendarSignalQuery, createEtfOutflowSignalQuery, createOpenInterestSignalQuery, type ModuleSignalProducer } from './moduleSignalQuery'
import { assembleSignalAnalysisRead, type ModuleSignalAnalysisRead } from '../analysis/signalAnalysisRead'

/**
 * The two readers behind `queryModuleSignals`, kept out of the public-query file.
 *
 * That file is a documented seam other lines read; it is also a file-size baseline that may only
 * shrink, and every leg that joins the list would otherwise add to it. The list itself stays here,
 * next to the legs it wires, so a new leg is an addition to this file and not to the seam.
 */
export type ModuleSignalHost = {
  queryOpenInterestHistory: (input: Readonly<{ asOf: string; window: OpenInterestWindow }>) => Promise<OpenInterestHistoryResult>
  /** The panel's own snapshot read: the ETF leg judges the rows the card already draws. */
  queryCapitalConditionsSnapshot: (input: Readonly<{ asOf: string }>) => Promise<CapitalConditionsSnapshotResult>
  queryModuleSignals: (input: Readonly<{ asOf: string; window?: OpenInterestWindow }>) => Promise<readonly SignalWithWindow[]>
  addModuleSignalProducer: (producer: ModuleSignalProducer) => void
} & MacroRouteQuery

/**
 * 「这条信号的分析到哪一步」的读取口，迟绑定。
 *
 * 与 `addModuleSignalProducer` 同一个理由：存储是 bootstrap 里才建出来的，服务层留挂载点、
 * 装配时注入。IPC 那层永远不知道账本和运行表的存在。
 *
 * 整个屏幕**恒定两次查询**：账本一次、运行一次，不按行查。
 */
export type SignalAnalysisReader = Readonly<{
  rows: (changeHashes: readonly string[]) => readonly { changeHash: string; decision: 'queued' | 'skipped' | 'recorded'; reasonCode: string; analysisRunId: string | null }[]
  runs: (runIds: readonly string[]) => Readonly<Record<string, { status: string; failureCode: string | null }>>
  analysisOffByReader: () => boolean | Promise<boolean>
}>

export function attachModuleSignals(host: ModuleSignalHost & {
  addSignalAnalysisReader: (reader: SignalAnalysisReader) => void
  queryModuleSignalRead: (input: Readonly<{ asOf: string; window?: OpenInterestWindow }>) => Promise<ModuleSignalAnalysisRead>
}): void {
  let analysisReader: SignalAnalysisReader | undefined
  host.addSignalAnalysisReader = (reader) => { analysisReader = reader }
  // A separate method, never a change to the old one: the callers switch together, later.
  host.queryModuleSignalRead = async (queryInput) => {
    const entries = await host.queryModuleSignals(queryInput)
    // 没挂读口不是「读到了但没有状态」，而是这一版根本读不了状态：装配缺了（老进程、半更新）。
    // 报 `contract-invalid`，句子说「这次没查到」——绝不说「下次刷新会再读」，那对装配缺失是不成立的承诺。
    if (!analysisReader) return { state: 'unavailable', failureCode: 'contract-invalid' }
    const changeHashes = [...new Set(entries.map(entry => entry.signal.dedupeKey))]
    const rows = analysisReader.rows(changeHashes)
    const runs = analysisReader.runs(rows.flatMap(row => row.analysisRunId ? [row.analysisRunId] : []))
    return assembleSignalAnalysisRead({
      signals: entries,
      droppedInvalid: 0,
      store: { listLatestSignalLedgerStates: () => rows, getRunsByIds: () => runs },
      analysisOffByReader: await analysisReader.analysisOffByReader()
    })
  }
  // The legs that can answer a signal today, each an addition to this list rather than a second
  // read of its own: the ETF leg reads the snapshot the capital-conditions card already draws.
  const producers: ModuleSignalProducer[] = [
    createOpenInterestSignalQuery({ readHistory: input => host.queryOpenInterestHistory(input) }),
    createEtfOutflowSignalQuery({ readSnapshot: input => host.queryCapitalConditionsSnapshot(input) }),
    // The calendar's own trigger key stays the only one that spends a call; this leg exists so the
    // chip and the analysis name the same release the same way.
    createCalendarSignalQuery({
      readObservations: async ({ asOf }) =>
        (await queryMacroRoute(host, { asOf, months: normalizeMacroRouteMonths(asOf, null) })).provider
    })
  ]
  host.addModuleSignalProducer = (producer) => { producers.push(producer) }
  host.queryModuleSignals = async (queryInput) => {
    if (!isCanonicalSignalTime(queryInput?.asOf)) return []
    // One leg that throws must not take the others down: each producer answers for itself, and a
    // failed read is already reported as an `unavailable` signal by the leg that owns it.
    const perProducer = await Promise.all(producers.map(async (producer) => {
      try {
        return await producer.query({ asOf: queryInput.asOf, ...(queryInput.window === undefined ? {} : { window: queryInput.window }) })
      } catch (error) {
        console.error('[signals] producer threw:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
        return []
      }
    }))
    return perProducer.flat()
  }
}
