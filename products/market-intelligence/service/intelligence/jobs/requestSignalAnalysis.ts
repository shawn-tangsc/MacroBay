import type { JobRuntime } from '@platform/jobs'
import type { AnalysisRun, EventGroup, EventGroupType } from '../../../contracts/marketAnalysisContracts'
import { queuedSignalEvidence, type SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import { signalTriggerKey, type ModuleSignal, type SignalWindow } from '../../../contracts/moduleSignal'
import { eventGroupPolicy } from '../analysis/eventGroupService'
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
  /**
   * 规则产出的那条信号本身。触发键、模块、规则、资产、严重度、数据时刻、去重键都从它取——
   * 调用方不再各带一份，免得同一件事在两个字段里说两句话。
   */
  signal: ModuleSignal
  /** 规则声明的窗口：账本读数要用它，`ModuleSignal` 故意不携窗口（窗口是规则自己的单位）。 */
  window: SignalWindow
  /** 牌子所属的板子；复用既有 `EventGroupType`，不新增枚举（OI→funding、ETF→capital）。 */
  groupType: EventGroupType
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
    const triggerKey = requestTriggerKey(request)
    const attemptLedgerId = deps.repository.appendTriggerLedger({
      id: `mi-ledger-${deps.idFactory()}`,
      eventGroupId: group.id,
      triggerKey,
      changeHash: request.signal.dedupeKey,
      decision: 'queued',
      // 读数跟着行一起存：阈值会改，读的时候再算就是拿今天的答案印在昨天的行上。横条的
      // 「装了几条」读 `signalCount`，详情的读数读 `signals[]`——两样都只有这一列能提供。
      reasonCode: signalAnalysisPolicy.queuedReasonCodes[request.signal.severity as 'medium' | 'high'],
      evidence: queuedSignalEvidence([{ signal: request.signal, window: request.window } as SignalWithWindow]),
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
          triggerKey,
          analysisPhase: 'correction',
          asOf: request.signal.observedAt,
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
    const mergeKey = signalGroupMergeKey(request.signal.moduleId, request.signal.observedAt)
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
      firstObservedAt: request.signal.observedAt,
      lastObservedAt: request.signal.observedAt,
      reviewDeadlineAt: new Date(Date.parse(request.signal.observedAt) + eventGroupPolicy.reviewWindowMs).toISOString(),
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
 * 收下的请求必须是**能排队的**信号。
 *
 * 键由契约的 `signalTriggerKey` 拼（两段齐全才拼得出来），所以 `signal.debug` 这种没有规则名的
 * 形状在这里直接拒绝；低档只显示牌子、不叫分析，进来就等于让「只展示」也花一次模型调用。
 */
function assertSignalRequest(request: SignalAnalysisRequest): void {
  requestTriggerKey(request)
  if (request.signal.severity !== 'medium' && request.signal.severity !== 'high') throw new Error('analysis-invalid-request')
  if (!Number.isFinite(Date.parse(request.signal.observedAt))) throw new Error('analysis-invalid-request')
}

/** The one key the signal is queued under; a signal without a complete key cannot be queued. */
function requestTriggerKey(request: SignalAnalysisRequest): string {
  const key = signalTriggerKey(request.signal.moduleId, request.signal.ruleId)
  if (!key) throw new Error('analysis-invalid-request')
  return key
}
