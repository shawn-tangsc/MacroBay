import type { SignalAnalysisStateView } from '../../../../service/intelligence/analysis/signalAnalysisState'

/**
 * 「这条信号的分析到哪一步」那一句。
 *
 * 两张码表**分开查**，这是这条句子唯一容易做错的地方：`skipped` 的原因来自账本行的 `reasonCode`
 * （`signal-*` / `fuse-tripped`），`failed` 的原因来自运行失败码（`analysis-*`）。合成一张，失败
 * 那次会拿 `analysis-*` 去账本表里查，查不到就渲染出「分析了但没成：」后面空着——有状态、没解释，
 * 比不给状态更糟。
 *
 * 码一律不上屏：查不到就落「原因没记录」，那是兜底，不该是常态。
 */
export type SignalAnalysisCopyPart =
  | { part: 'state' | 'stoppedReason'; code: string }
  | { part: 'skippedReason' | 'failedReason'; code: string }
  | { part: 'reasonUnknown' | 'separator' }

/** 由渲染层提供：键 → 句子，未知键返回空串。缺的句子在这里统一落到兜底。 */
export type SignalAnalysisCopyLookup = (query: SignalAnalysisCopyPart) => string

export function signalAnalysisSentence(view: SignalAnalysisStateView, lookup: SignalAnalysisCopyLookup): string | undefined {
  // 「还在等」不是信息：还没轮到、已经排上队，一个字都不出现（连占位都不要）。
  // 界面只留两样东西——已经发生的结果，和为什么不分析。
  if (view.analysisState === 'not-triggered' || view.analysisState === 'queued') return undefined
  const unknown = lookup({ part: 'reasonUnknown' })
  const state = lookup({ part: 'state', code: view.analysisState }) || unknown
  const code = view.analysisReason ?? ''
  if (view.analysisState === 'skipped') {
    return `${state}${lookup({ part: 'separator' })}${lookup({ part: 'skippedReason', code }) || unknown}`
  }
  if (view.analysisState === 'failed') {
    return `${state}${lookup({ part: 'separator' })}${lookup({ part: 'failedReason', code }) || unknown}`
  }
  if (view.analysisState === 'stopped') {
    // 停下的三句本身就是完整句子，不再拼原因。
    return lookup({ part: 'stoppedReason', code }) || unknown
  }
  return state
}
