import type { StructuredModelMessage } from '@platform/ai/invocation/structuredModelInvocationTypes'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import type { AnalysisKind } from '../../../contracts/analysisKinds'
import type {
  AnalysisRun, AnalysisSummary, EvidenceSnapshot, Prediction, TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import type { AnalysisSessionInput } from './analysisModelPrompt'
import type { AnalysisOutputValidationResult, FrozenAnalysisEvidence, ValidatedAnalysisModelOutput } from './analysisOutputValidator'
import type { TriggerFocus } from './analysisTriggerFocus'
import type { SignificanceSignal } from './significanceChangeMatcher'
import type { AnalysisConclusionNotice } from './analysisConclusionNotifier'
import { marketAnalysisLine } from './marketAnalysisLine'
import { newsAnalysisLine } from './newsAnalysisLine'

/**
 * 一条解析线要实现的东西（R39 §2）。
 *
 * 今天只有两条：市场（`market`）与新闻（`news`）。选择点只有一个——编排器拿到 run 后按
 * `run.analysisKind` 取线，其余代码不认识具体线。`run.analysisKind` 从库里读，不从处理器
 * 载荷猜：载荷跨重启不保证，run 行才是记录。
 *
 * 公共部分（冻结快照、运行状态机、单飞、传输重试、通知投递、保留、归档、IO 用量）不在
 * 这里，也不许按线分叉。
 */
export type AnalysisLinePersistDeps = Readonly<{
  repository: Readonly<{
    commitSuccessfulAnalysis: (input: Readonly<{
      runId: string
      summary: AnalysisSummary
      predictions: readonly Prediction[]
      timeline?: TimelineEntry
      /** 市场线把摘要挂成组的当前结论；新闻线不挂（组上没有市场摘要）。 */
      recordGroupPointer?: boolean
    }>) => void
    /** 新闻线算版本用：组指针只记市场摘要，新闻记录按行取最大版本。 */
    latestSummaryVersion?: (eventGroupId: string) => number
    /** 市场线写版本要用组的当前摘要指针（新闻线不挂指针，不读它）。 */
    getEventGroup?: (id: string) => Readonly<{ currentSummaryId: string | null }> | undefined
    getSummary?: (id: string) => Readonly<{ version: number }> | undefined
    triggerReasonOf?: (runId: string) => string | undefined
  }>
  /** 冻结快照：市场推送要写 as-of，新闻线只读不改。 */
  snapshot: EvidenceSnapshot
  now: string
  idFactory: () => string
  proseLanguage?: 'zh-CN' | 'en-US'
  appendRunSummary?: (input: Readonly<{ runId: string; summary: string }>) => Promise<void>
  notifyAnalysisConclusion?: (notice: AnalysisConclusionNotice) => Promise<void>
  readTriggerSignal?: (triggerKey: string) => Readonly<{ direction?: 'bullish' | 'bearish'; factIds?: readonly string[] }>
}>

export type AnalysisLine = Readonly<{
  analysisKind: AnalysisKind
  promptVersion: string
  skillVersion: string
  outputSchemaVersion: 1 | 2 | 3
  buildMessages: (
    snapshot: EvidenceSnapshot,
    significanceSignals: readonly SignificanceSignal[],
    session: AnalysisSessionInput | undefined,
    proseLanguage: AppLanguage | undefined
  ) => StructuredModelMessage[]
  validate: (raw: string, evidence: FrozenAnalysisEvidence, focus: TriggerFocus | undefined) => AnalysisOutputValidationResult
  /** 哪些拒收码值得同快照再问一遍；每条线自己定。 */
  repairableRejections: ReadonlySet<string>
  /** 写库与发布副作用。市场线写预测、时间轴、组指针、会话摘要与推送；新闻线只写记录。 */
  persist: (run: AnalysisRun, output: ValidatedAnalysisModelOutput, deps: AnalysisLinePersistDeps) => Promise<void>
}>

const lines: Readonly<Record<AnalysisKind, AnalysisLine>> = Object.freeze({
  market: marketAnalysisLine,
  news: newsAnalysisLine
})

/**
 * 全仓唯一的选择点。类别是闭集，所以这里不会被未知值调用；万一被调用，宁可当场失败，
 * 也不把一次运行套到另一条线的提示词上。
 */
export function lineFor(analysisKind: AnalysisKind): AnalysisLine {
  return lines[analysisKind]
}
