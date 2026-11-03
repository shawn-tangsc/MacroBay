import type { JobRuntime } from '@platform/jobs'
import type { AnalysisRun, EventGroup, EventGroupType } from '../../../contracts/marketAnalysisContracts'
import { isMarketAnalysisCanonicalUtc } from '../../../contracts/marketAnalysisContracts'
import { eventGroupPolicy } from '../analysis/eventGroupService'
import { isSignalTriggerKey } from '../analysis/analysisTriggerSourcePolicy'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'

/**
 * 最后一跳的接收端：把一条模块信号变成一次可排队的分析。
 *
 * 三条自动入口原来都锚在情报条目上（`requestInitialMarketAnalysis` 没有合格条目就抛
 * `analysis-not-eligible`），所以「规则命中」永远走不到分析。这一层补的就是那一段：信号不需要
 * 条目，它有自己的组、自己的账本行，入队以后和别的触发一样过闸门（事件线额度）。
 *
 * 不在这里做的事，说清楚免得实现时又被塞进来：
 * - **不判阈值**：严重度是规则给的，低档根本不该到这里（这里只接受 medium / high）。
 * - **不判去重**：`changeHash` 由规则线按「模块/规则/资产/桶」算出，账本唯一键再挡一次。
 * - **不判额度**：额度在闸门里（`analysisSignificanceGate`），这里只保证它看到的是事件线。
 * - **不做单飞以外的合并**：同一组已有在跑的 freeze/run 就不再入队；同刻多条信号合并成一次
 *   运行是扫描层的职责（04 §11），不是这一层的。
 *
 * 行先写、后入队：入队失败立刻把这一行翻成 `skipped` + `signal-freeze-unavailable`——没花出去的
 * 调用不能算花掉（否则一次入队失败会白扣一次事件线额度）。
 */

export type SignalAnalysisRequest = Readonly<{
  /** `signal.<moduleId>.<ruleId>`，与下面两个字段必须一致（见 `assertSignalRequest`）。 */
  triggerKey: string
  moduleId: string
  ruleId: string
  /** 牌子所属的板子；复用既有 `EventGroupType`，不新增枚举。 */
  groupType: EventGroupType
  /**
   * 规则判出的严重度。低档只显示牌子、不叫分析，所以这里不接受 `low`：让它进来就等于让「只展示」
   * 也花一次模型调用。
   */
  severity: 'medium' | 'high'
  /** 信号描述的那一刻（数据时刻），也是快照的 `asOf`。 */
  observedAt: string
  /** 这条信号的去重键（模块/规则/资产/同一桶），写进账本唯一键。 */
  changeHash: string
}>

export type SignalAnalysisOutcome =
  | Readonly<{ state: 'queued'; groupId: string; attemptLedgerId: string; jobRunId: string }>
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'in-flight'; groupId: string }>

export type SignalAnalysisService = (request: SignalAnalysisRequest) => Promise<SignalAnalysisOutcome>

export const signalAnalysisPolicy = Object.freeze({
  version: 'marketAnalysisSignalEntry.v1',
  /** 与条目组同一个复盘窗口：信号组只当锚，不参与条目路径的关闭/继任。 */
  mergeKeyPrefix: 'signal' as const,
  /** 入队失败写进那一行的原因码（已登记，时间轴会把它说成「分析没能排上」）。 */
  freezeUnavailableReasonCode: 'signal-freeze-unavailable' as const,
  /** 账本行先写的「允许」原因码，按严重度二选一。 */
  queuedReasonCodes: Object.freeze({ medium: 'signal-medium-triggered', high: 'signal-high-triggered' })
})

export function createSignalAnalysisRequest(deps: Readonly<{
  repository: MarketAnalysisRepository
  jobRuntime: Pick<JobRuntime, 'enqueueDefinition' | 'listRuns'>
  now: () => string
  idFactory: () => string
  /** The capability's switch. Off means no group, no row, no queue — "关闭" must leave nothing behind. */
  isEnabled: () => Promise<boolean>
}>): SignalAnalysisService {
  return async (request) => {
    assertSignalRequest(request)
    if (!await deps.isEnabled()) return { state: 'disabled' }
    const group = findOrCreateGroup(request)
    // 单飞：同一组已有在跑的 freeze 或 run，就不重复入队。信号每次采样都会重算一次，
    // 没有这道，同一个桶会进两次。
    const activeFreeze = deps.jobRuntime.listRuns({
      handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
      statuses: ['queued', 'running'],
      payload: { eventGroupId: group.id },
      limit: 1
    })
    const inFlightRun = deps.repository.listRuns().some((run: AnalysisRun) =>
      run.eventGroupId === group.id && (run.status === 'queued' || run.status === 'running'))
    if (activeFreeze.length > 0 || inFlightRun) return { state: 'in-flight', groupId: group.id }
    const attemptLedgerId = deps.repository.appendTriggerLedger({
      id: `mi-ledger-${deps.idFactory()}`,
      eventGroupId: group.id,
      triggerKey: request.triggerKey,
      changeHash: request.changeHash,
      decision: 'queued',
      reasonCode: signalAnalysisPolicy.queuedReasonCodes[request.severity],
      snapshotHash: null,
      analysisRunId: null,
      createdAt: deps.now()
    })
    try {
      const job = await deps.jobRuntime.enqueueDefinition({
        id: `market-analysis:signal-freeze:${group.id}`,
        owner: 'product',
        productId: 'market-intelligence',
        handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
        title: 'Freeze signal analysis snapshot',
        trigger: { kind: 'manual' },
        // `analysisPhase: 'correction'`：信号是对已有判断的修正，不是首篇。
        payload: {
          eventGroupId: group.id,
          triggerKey: request.triggerKey,
          analysisPhase: 'correction',
          asOf: request.observedAt,
          attemptLedgerId
        }
      })
      return { state: 'queued', groupId: group.id, attemptLedgerId, jobRunId: job.id }
    } catch (error) {
      // 没花出去就不算花掉：这一行本来要算一次事件线调用，现在它不是了。
      deps.repository.updateTriggerLedgerDecision(attemptLedgerId, 'skipped', signalAnalysisPolicy.freezeUnavailableReasonCode)
      throw error
    }
  }

  function findOrCreateGroup(request: SignalAnalysisRequest): EventGroup {
    const mergeKey = signalGroupMergeKey(request.moduleId, request.observedAt)
    const existing = deps.repository.findEventGroupByMergeKey(mergeKey)
    if (existing) return existing
    // 信号不是条目：`eventRefs` 留空比塞一个假 itemId 诚实。组只当锚，`mergeKey` 带 UTC 日，
    // 免得和昨天的组撞唯一键。
    const createdAt = deps.now()
    const group: EventGroup = {
      id: `mi-eg-${deps.idFactory()}`,
      schemaVersion: 1,
      status: 'open',
      groupType: request.groupType,
      mergeKey,
      firstObservedAt: request.observedAt,
      lastObservedAt: request.observedAt,
      reviewDeadlineAt: new Date(Date.parse(request.observedAt) + eventGroupPolicy.reviewWindowMs).toISOString(),
      eventRefs: [],
      triggerCount: 0,
      reviewCount: 0,
      currentSummaryId: null,
      supersededByGroupId: null,
      revision: 1,
      createdAt,
      updatedAt: createdAt
    }
    deps.repository.appendEventGroup(group)
    return group
  }
}

/** `signal.<moduleId>.<ruleId>`，一天一组。 */
export function signalGroupMergeKey(moduleId: string, observedAt: string): string {
  return [signalAnalysisPolicy.mergeKeyPrefix, moduleId, observedAt.slice(0, 10)].join('|')
}

/**
 * 收下的请求必须是**完整**的信号键。
 *
 * 前缀判定会放过 `signal.debug` 这种没有 module/rule 两段的键；放进来的话，账本、额度线和时间轴
 * 都会把一条「不知道是哪条规则」的记录当成真事。所以这里要求键与两个字段逐字一致，并且时间是可
 * 排队的 UTC 瞬时。
 */
function assertSignalRequest(request: SignalAnalysisRequest): void {
  if (!isSignalTriggerKey(request.triggerKey)) throw new Error('analysis-invalid-request')
  if (request.triggerKey !== `signal.${request.moduleId}.${request.ruleId}`) throw new Error('analysis-invalid-request')
  if (request.severity !== 'medium' && request.severity !== 'high') throw new Error('analysis-invalid-request')
  if (!isMarketAnalysisCanonicalUtc(request.observedAt) || !Number.isFinite(Date.parse(request.observedAt))) throw new Error('analysis-invalid-request')
  if (request.changeHash.length === 0) throw new Error('analysis-invalid-request')
}
