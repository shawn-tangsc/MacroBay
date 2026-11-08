import type { NotificationApprovedLevel, NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { AnalysisRun, AnalysisSummary } from '../../../contracts/marketAnalysisContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { buildAnalysisConclusionRequest } from './analysisConclusionPush'

/**
 * 读者在抽屉里点「发送到频道」：把**眼前那条结论**按自动推送**同一条路**再发一次。
 *
 * 三件事刻意与自动路径不同，其余全部相同（同一个事件、同一个构造器、同一个提交入口）：
 * - **去重键带点击时刻**（`analysis:{触发键}:{截止时刻}:{点击时刻}`）：每次点击都是新键，
 *   真实事件那条键不受影响，真实推送之后也不会因为这次点击被挡；
 * - **不收窄**：读者点名要发，就不套「同向只进中心」；
 * - **不数本进程配额**：那本账是自动推送给自己踩的刹车，读者点一次不算一次自动推送。
 *
 * 但**平台的每日上限照样吃**（事件声明 `dailyLimit: 4`，按 UTC 自然日）：第五条会拿到
 * `rejected / daily-limit-reached`，界面必须说「今天的上限到了」，不是「发送失败」。
 * 免打扰与通道不可用发生在**提交成功之后**（记录照建、`delivery.push` 缺席或带 reason），
 * 这两档只能靠回执里的记录去判——不是这里能替平台下的结论。
 *
 * 这里不发散：拿不到运行/结论就给具名原因，提交被拒就原样交回平台的原因码，不自己编句子。
 */

export type AnalysisConclusionSendReceipt =
  | Readonly<{ kind: 'accepted'; recordId: string; levels: readonly NotificationApprovedLevel[] }>
  /** `reason` 是平台拒绝码（如 `daily-limit-reached`）或本层的三种「取不到」（`run-missing` 等）。 */
  | Readonly<{ kind: 'rejected'; reason: string }>

export type AnalysisConclusionSendInput = Readonly<{ analysisRunId: string }>

export type AnalysisConclusionManualSendDeps = Readonly<{
  repository: Readonly<{
    getRun: (id: string) => AnalysisRun | undefined
    getSummaryForRun: (analysisRunId: string) => AnalysisSummary | undefined
    /** 截止时刻（快照的 `asOf`）；缺省时退回结论的写出时刻，仍然稳定。 */
    getSnapshot?: (id: string) => Readonly<{ asOf: string }> | undefined
  }>
  /** 通知提交入口：**与自动推送同一个**。没装配就报 `submit-unavailable`，不假装发过。 */
  submit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now: () => string
}>

export type AnalysisConclusionSend = (input: AnalysisConclusionSendInput) => Promise<AnalysisConclusionSendReceipt>

export function createAnalysisConclusionManualSend(deps: AnalysisConclusionManualSendDeps): AnalysisConclusionSend {
  return async (input) => {
    if (deps.submit === undefined) return { kind: 'rejected', reason: 'submit-unavailable' }
    const run = deps.repository.getRun(input.analysisRunId)
    if (run === undefined) return { kind: 'rejected', reason: 'run-missing' }
    const summary = deps.repository.getSummaryForRun(run.id)
    // 结论只在结构化 `conclusion` 里；老记录的自由文本（`eventAssessment`）不拿来发——
    // 那是"方向：偏空：…"的整段机器串，读者手机上会看到一段谁都不认的文本。
    const conclusion = summary?.conclusion
    if (summary === undefined || conclusion === undefined) return { kind: 'rejected', reason: 'conclusion-missing' }
    const clickAt = deps.now()
    const cutoff = deps.repository.getSnapshot?.(run.snapshotId)?.asOf ?? summary.createdAt
    const request = {
      eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisConclusion,
      ...buildAnalysisConclusionRequest({
        summary: conclusion.summary,
        citedCount: summary.evidenceRefs.length,
        triggerKey: run.triggerKey,
        // 点击时刻进第二个分量：同一条结论点两次是两条键，不会合并成一条，也不占真实事件的键。
        cutoff: `${cutoff}:${clickAt}`,
        occurredAt: clickAt,
        centerOnly: false
      })
    }
    const outcome = await deps.submit(request)
    if (outcome.kind === 'accepted') return { kind: 'accepted', recordId: outcome.recordId, levels: outcome.levels }
    // 合并成一条也算发出去了：记录身份就是回执里那一条（读它的 `delivery.push` 才判得出到没到手机）。
    if (outcome.kind === 'merged') return { kind: 'accepted', recordId: outcome.recordId, levels: [] }
    if (outcome.kind === 'rejected') return { kind: 'rejected', reason: outcome.reason }
    // `delegated`/`collapsed` 在这条事件上不该出现；出现了就是"没发"——不许说成已发送。
    return { kind: 'rejected', reason: outcome.kind }
  }
}
