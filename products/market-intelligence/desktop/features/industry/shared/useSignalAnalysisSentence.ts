import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { SignalAnalysisStateView } from '../../../../service/intelligence/analysis/signalAnalysisState'
import { signalAnalysisSentence, type SignalAnalysisCopyPart } from './signalAnalysisSentence'

const BASE = 'pages.intelligence.portal.dashboard.signalAnalysis'
const TRIGGER = 'pages.intelligence.portal.dashboard.analysisTimeline.triggerStatus'

/**
 * 把状态投影成读者那句白话。
 *
 * 两张原因表在这里**分别查**：`skipped` 查账本的 `reasons`，`failed` 查运行的 `failureReasons`；
 * 未知码统一落「原因没记录」。码本身永不上屏——写错一个码，读者也该看到一句人话。
 */
export function useSignalAnalysisSentence(view: SignalAnalysisStateView | undefined): string | undefined {
  const resolveText = useProductTextKey()
  if (!view) return undefined
  return signalAnalysisSentence(view, (query: SignalAnalysisCopyPart) => {
    if (query.part === 'state') return resolveText(`${BASE}.states.${query.code}`)
    if (query.part === 'stoppedReason') return resolveText(`${BASE}.stoppedReasons.${query.code}`)
    if (query.part === 'skippedReason') return resolveText(`${TRIGGER}.reasons.${query.code}`)
    if (query.part === 'failedReason') return resolveText(`${TRIGGER}.failureReasons.${query.code}`)
    if (query.part === 'separator') return resolveText(`${BASE}.separator`)
    return resolveText(`${BASE}.reasonUnknown`)
  })
}
