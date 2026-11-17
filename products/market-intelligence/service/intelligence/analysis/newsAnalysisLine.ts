import type { AnalysisSummary } from '../../../contracts/marketAnalysisContracts'
import type {
  NewsInterpretationBody, NewsInterpretationRecord
} from '../../../contracts/newsInterpretationContracts'
import type { AnalysisLine } from './analysisLineRegistry'
import { repairableRejection } from './analysisModelRepair'
import { makeAnalysisRecordId } from './analysisRecordBuilders'
import { buildNewsAnalysisMessages } from './newsAnalysisPrompt'
import { toSummaryParagraphs, validateNewsInterpretation } from './newsValidation'

/**
 * 新闻线（R39 C）。
 *
 * 自己的契约（`NewsInterpretation`）、13 条校验与三段式提示词；与市场线共用冻结快照、
 * 运行状态机、单飞、传输重试、通知投递与 IO 用量。
 *
 * 写库副作用与市场线不同：**没有**预测行、时间轴、组当前结论指针、会话摘要、推送——
 * 新闻解读只活在抽屉里。`recordGroupPointer: false` 是必须的：组指针是「这个组当前的市场
 * 结论」，`getWorkspaceBinding` 靠它绑工作区。
 */
export const newsAnalysisLine: AnalysisLine = Object.freeze({
  analysisKind: 'news',
  // C 的提示词与输出契约都换了，版本跟着走；新闻契约的 schemaVersion 从 1 起，与市场的 3 不是一个序列。
  promptVersion: 'news-analysis-v2',
  skillVersion: 'news-analysis-v1',
  outputSchemaVersion: 1,

  buildMessages(snapshot, significanceSignals, session, context) {
    return buildNewsAnalysisMessages(snapshot, significanceSignals, session, context)
  },

  validate(raw, evidence, _focus, context) {
    // 新闻线只认自己的 13 条：不跑市场线的方向/情景/背离校验（记录里没有那些块）。
    return validateNewsInterpretation(raw, evidence, {
      timeZone: context.timeZone,
      ...(context.proseLanguage === undefined ? {} : { proseLanguage: context.proseLanguage })
    })
  },

  repairableRejections: repairableRejection,

  async persist(run, output, deps) {
    const body = output as NewsInterpretationBody
    const paragraphs = toSummaryParagraphs(body)
    // 落库前三段非空：空段会被渲染侧静默丢掉，等于少一段（映射是唯一实现，这里只做关口）。
    if (!paragraphs.summary.trim() || !paragraphs.change.trim() || !paragraphs.causalChain.trim()) {
      throw new Error('news-interpretation-paragraphs-empty')
    }
    const itemId = deps.snapshot.trigger?.itemId
    if (!itemId) throw new Error('news-interpretation-item-missing')
    const id = makeAnalysisRecordId('mi-as-', deps.idFactory())
    const record: NewsInterpretationRecord = {
      ...body,
      id, runId: run.id, itemId, createdAt: deps.now,
      ...(deps.proseLanguage === undefined ? {} : { proseLanguage: deps.proseLanguage })
    }
    // 组指针只记市场摘要；新闻记录按行取最大版本，否则同一条新闻的第二次解读会撞唯一键。
    const version = (deps.repository.latestSummaryVersion?.(run.eventGroupId) ?? 0) + 1
    const summary: AnalysisSummary = {
      id, schemaVersion: 1, analysisKind: 'news', analysisRunId: run.id, eventGroupId: run.eventGroupId, version,
      ...(deps.proseLanguage === undefined ? {} : { proseLanguage: deps.proseLanguage }),
      createdAt: deps.now,
      conclusion: {
        direction: body.outlook.direction,
        summary: paragraphs.summary,
        change: paragraphs.change,
        causalChain: paragraphs.causalChain,
        conditions: [], macro: null, evidenceStrength: null, dataGaps: []
      },
      // 市场线的记录字段在新闻记录里没有意义：留空数组，读者与任何市场面都不读它们。
      knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
      scenarios: [], directions: [], nextCatalysts: [], dataCaveats: [],
      evidenceRefs: [...new Set([body.what.evidenceRefId, ...body.reading.checks.map(check => check.evidenceRefId)])],
      newsInterpretation: record
    }
    deps.repository.commitSuccessfulAnalysis({ runId: run.id, summary, predictions: [], recordGroupPointer: false })
  }
})
