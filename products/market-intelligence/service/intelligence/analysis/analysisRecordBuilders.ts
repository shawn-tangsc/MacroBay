import type {
  AnalysisRun, AnalysisSummary, Prediction, TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import type { ValidatedAnalysisModelOutput } from './analysisOutputValidator'

/**
 * 一次运行的「记录」怎么从模型输出拼出来。
 *
 * 两条线共用同一张记录表与同一套三段字段，所以拼接只有这一份；线的差别在
 * 「写不写预测、时间轴、组指针」，不在摘要长什么样。放这里是为了让两个线模块都不必
 * 各抄一遍 id 前缀与 schemaVersion。
 */
export function makeAnalysisRecordId(prefix: string, value: string): string {
  return value.startsWith(prefix) ? value : `${prefix}${value}`
}

export function buildAnalysisSummary(
  run: AnalysisRun,
  output: ValidatedAnalysisModelOutput,
  version: number,
  createdAt: string,
  idFactory: () => string,
  proseLanguage?: 'zh-CN' | 'en-US'
): AnalysisSummary {
  // 提示词在语言读不到时按中文写（`buildAnalysisMessages` 的默认），所以记录也写中文：
  // 记录的是「这份正文实际用的语言」，不是「读没读到设置」。
  return {
    id: makeAnalysisRecordId('mi-as-', idFactory()), schemaVersion: 3, analysisKind: run.analysisKind,
    analysisRunId: run.id, eventGroupId: run.eventGroupId, version,
    proseLanguage: proseLanguage ?? 'zh-CN', ...output, createdAt
  }
}

/** 预测行只属于市场线：到期核验是市场口径，新闻解读不写。 */
export function buildPredictionRecords(
  summary: AnalysisSummary,
  output: ValidatedAnalysisModelOutput,
  createdAt: string,
  idFactory: () => string
): Prediction[] {
  return output.scenarios.map((scenario) => {
    const horizonMs = scenario.horizon === '0-15m' ? 15 * 60_000 : scenario.horizon === '15m-2h' ? 2 * 60 * 60_000 : scenario.horizon === '2h-24h' ? 24 * 60 * 60_000 : 3 * 24 * 60 * 60_000
    const horizonEnd = new Date(Date.parse(createdAt) + horizonMs).toISOString()
    return {
      id: makeAnalysisRecordId('mi-pr-', idFactory()), schemaVersion: 1, summaryId: summary.id, asset: scenario.asset,
      horizonStart: createdAt, horizonEnd, baseCase: scenario.baseCase, conditions: scenario.conditions,
      nextCatalyst: output.nextCatalysts[0]?.statement ?? null, status: 'pending', verificationDueAt: horizonEnd, createdAt,
      invalidation: typeof scenario.invalidation === 'string' ? scenario.invalidation : scenario.invalidation.statement
    }
  })
}

/** 发布时间轴行只属于市场线：新闻解读进抽屉，不进市场时间轴。 */
export function buildPublishedTimeline(run: AnalysisRun, summary: AnalysisSummary, idFactory: () => string): TimelineEntry {
  return {
    id: makeAnalysisRecordId('mi-tl-', idFactory()), schemaVersion: 1, eventGroupId: run.eventGroupId, analysisRunId: run.id,
    kind: run.analysisPhase === 'review' ? 'review' : 'analysis', status: 'published', occurredAt: summary.createdAt,
    summaryRef: summary.id,
    safeTitle: '市场分析已生成',
    safeExcerpt: summary.conclusion?.summary ?? summary.eventAssessment ?? null,
    direction: summary.conclusion?.direction ?? null,
    version: summary.version
  }
}
