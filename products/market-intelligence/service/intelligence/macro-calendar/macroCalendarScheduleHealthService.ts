import type { MacroCalendarCollectionInput } from './macroCalendarCollectionService'
import { macroCalendarScheduleCollectionWorkflowPolicy, type MacroCalendarScheduleCollectionWorkflow } from './macroCalendarScheduleCollectionWorkflow'
import type { MacroCalendarProviderHealthRevision, MacroCalendarProviderId,
  MacroCalendarWriteFailure } from './macroCalendarContracts'
import type { MacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'

export type MacroCalendarScheduleHealthService = {
  collectAndUpdateHealth: (input: MacroCalendarCollectionInput) => Promise<MacroCalendarScheduleHealthResult>
}

export type MacroCalendarScheduleHealthResult =
  | { descriptorId: string; state: 'skipped'; failureCode: 'descriptor-not-found' }
  | { providerId: string; descriptorId: string; state: 'skipped'; failureCode: 'schedule-descriptor-unavailable' }
  | { descriptorId: string; state: 'failed'; failureCode: 'collection-input-invalid' }
  | { providerId: string; descriptorId: string; state: 'failed'; failureCode: 'workflow-result-invalid' | 'workflow-execution-failed' | 'health-persist-failed' }
  | { providerId: string; descriptorId: string; state: 'updated'; healthStatus: 'healthy' | 'degraded' | 'failed' | 'paused'; consecutiveFailures: number }

export const macroCalendarScheduleHealthPolicy = {
  eligibleDescriptorIds: ['macro-calendar-fed-schedule', 'macro-calendar-bea-schedule'],
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  persistenceFailureCodes: ['evidence-not-found', 'evidence-invalid', 'parser-unavailable', 'payload-invalid', 'parser-output-empty', 'schedule-input-invalid', 'repository-write-failed']
} as const

/**
 * 工作流端口的**返回值在运行期不可信**：`healthRevision(outcome: unknown, …)` 是服务自己的一道守卫，
 * 它逐字段判 `null`、错 provider / descriptor、缺计数、错失败码——这些值类型系统拦不住
 * （跨 HTTP / 解析边界），只能在这里拒。所以端口写 `Promise<unknown>` 是**说出真实契约**，
 * 不是放宽：合法返回值照常通过，非法返回值落到既有的 `workflow-result-invalid`。
 */
export type MacroCalendarScheduleHealthWorkflow = {
  collectAndPersistSchedule: (input: MacroCalendarCollectionInput) => Promise<unknown>
}

export function createMacroCalendarScheduleHealthService(deps: {
  workflow: MacroCalendarScheduleHealthWorkflow
  health: Pick<MacroCalendarProviderHealthStore, 'getCurrent' | 'appendMaterialChange'>
  /**
   * 装配层注进来的日志出口。**别用 `console.warn`**：主进程的 JSON 日志只收这条通道，
   * `console.warn` 走 stdout——开发时在终端里、打包后直接丢。上一版就是这样「加了留痕、实际没有」：
   * 采集连续失败 18 次，`app.log` 里按「采集」筛 0 条命中。
   */
  log?: (level: 'warn', event: string, fields?: Record<string, unknown>) => void
}): MacroCalendarScheduleHealthService {
  const log = (event: string, fields: Record<string, unknown>): void => { deps.log?.('warn', event, fields) }
  return {
    async collectAndUpdateHealth(input) {
      if (!isValidInput(input)) return { descriptorId: safeDescriptorId(input), state: 'failed', failureCode: 'collection-input-invalid' }
      const descriptor = getMacroCalendarOfficialSourceDescriptor(input.descriptorId)
      if (!descriptor) return { descriptorId: input.descriptorId, state: 'skipped', failureCode: 'descriptor-not-found' }
      const identity = { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId }
      if (!(macroCalendarScheduleHealthPolicy.eligibleDescriptorIds as readonly string[]).includes(descriptor.descriptorId)) {
        return { ...identity, state: 'skipped', failureCode: 'schedule-descriptor-unavailable' }
      }

      let outcome: unknown
      try {
        outcome = await deps.workflow.collectAndPersistSchedule(input)
      } catch (error) {
        // **失败原因必须留痕**：这里的 `catch` 原来是空的，采集连续失败 15 次、日志里却只有一句
        // 「run failed」，事后无从下手。抛错与「工作流自己报失败」分开写。
        log('macro-calendar.schedule.collect-threw', { descriptorId: descriptor.descriptorId,
          detectedAt: input.detectedAt, message: error instanceof Error ? error.message : String(error) })
        return { ...identity, state: 'failed', failureCode: 'workflow-execution-failed' }
      }
      let next
      try {
        next = healthRevision(outcome, identity, descriptor.parserId, input.detectedAt, deps.health.getCurrent)
      } catch {
        return { ...identity, state: 'failed', failureCode: 'health-persist-failed' }
      }
      if (!next) {
        // 工作流跑完了但结果形状不认：把原文打出来，否则和「源挂了」分不开。
        console.warn(`[macro-calendar] ${descriptor.descriptorId} 采集结果形状不认（detectedAt=${input.detectedAt}）：`
          + JSON.stringify(outcome).slice(0, 400))
        return { ...identity, state: 'failed', failureCode: 'workflow-result-invalid' }
      }
      /**
       * **写入失败与来源状态并列**（架构师 2026-11-19）：工作流把 `writeFailure` 放在 outcome 里，
       * 这里**只抄不改**——`status` 仍只反映采集。形状不认就丢掉，不猜。
       */
      const writeFailure = readWriteFailure(outcome)
      if (writeFailure !== undefined) {
        next = { revision: { ...next.revision, lastWriteFailure: writeFailure } }
        log('macro-calendar.standard.write-failed', { descriptorId: descriptor.descriptorId,
          at: writeFailure.at, failedRows: writeFailure.failedRows, firstErrorCode: writeFailure.firstErrorCode })
      }
      if (next.revision.status === 'failed') {
        log('macro-calendar.schedule.collect-failed', { descriptorId: descriptor.descriptorId,
          detectedAt: input.detectedAt, failureCode: String((outcome as { failureCode?: unknown }).failureCode ?? 'unknown') })
      }
      try {
        deps.health.appendMaterialChange(next.revision)
      } catch {
        return { ...identity, state: 'failed', failureCode: 'health-persist-failed' }
      }
      return { ...identity, state: 'updated', healthStatus: next.revision.status, consecutiveFailures: next.revision.consecutiveFailures }
    }
  }
}

function healthRevision(
  outcome: unknown,
  identity: { providerId: MacroCalendarProviderId; descriptorId: string },
  parserVersion: string,
  detectedAt: string,
  getCurrent: MacroCalendarProviderHealthStore['getCurrent']
): { revision: MacroCalendarProviderHealthRevision } | undefined {
  if (!isObject(outcome) || outcome.providerId !== identity.providerId || outcome.descriptorId !== identity.descriptorId) return undefined
  const base = { providerId: identity.providerId, updatedAt: detectedAt, checkpoint: { parserVersion } }
  if (isPersisted(outcome)) return { revision: { ...base, status: 'healthy' as const, lastSuccessAt: detectedAt, consecutiveFailures: 0 } }
  const priorFailures = safeFailureCount(getCurrent(identity.providerId)?.consecutiveFailures)
  if (isProviderDisabled(outcome)) return { revision: { ...base, status: 'paused' as const, consecutiveFailures: priorFailures } }
  if (isFailed(outcome)) return { revision: { ...base, status: 'failed' as const, lastFailureAt: detectedAt, consecutiveFailures: priorFailures + 1 } }
  return undefined
}

/** outcome 里的写入失败：三格形状与闭集都对才认，否则当作没有（不编）。 */
function readWriteFailure(value: unknown): MacroCalendarWriteFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const failure = (value as { writeFailure?: unknown }).writeFailure
  if (typeof failure !== 'object' || failure === null) return undefined
  const { at, failedRows, firstErrorCode } = failure as Record<string, unknown>
  if (typeof at !== 'string' || !isCanonicalUtcMillis(at)) return undefined
  if (typeof failedRows !== 'number' || !Number.isInteger(failedRows) || failedRows < 0) return undefined
  if (firstErrorCode !== 'standard-write-failed' && firstErrorCode !== 'value-shape-rejected') return undefined
  return { at, failedRows, firstErrorCode }
}

function isPersisted(value: Record<string, unknown>): boolean {
  return value.state === 'persisted' && isHttpSuccess(value.status) && isNonNegativeSafeInteger(value.acceptedBytes) &&
    isNonNegativeSafeInteger(value.insertedCount) && isNonNegativeSafeInteger(value.dedupedCount)
}

function isProviderDisabled(value: Record<string, unknown>): boolean {
  return value.state === 'skipped' && value.failureCode === 'provider-disabled' && value.status === undefined
}

function isFailed(value: Record<string, unknown>): boolean {
  if (value.state !== 'failed' || typeof value.failureCode !== 'string') return false
  if (value.failureCode === 'collection-result-invalid') return value.status === undefined && value.insertedCount === undefined
  if (macroCalendarScheduleHealthPolicy.persistenceFailureCodes.includes(value.failureCode as never)) {
    return value.status === undefined && (value.insertedCount === undefined || isNonNegativeSafeInteger(value.insertedCount))
  }
  if (!macroCalendarScheduleCollectionWorkflowPolicy.failedFailureCodes.includes(value.failureCode as never)) return false
  return isValidFailureStatus(value.failureCode, value.status)
}

function isValidFailureStatus(failureCode: string, status: unknown): boolean {
  if (status === undefined) return true
  const ranges = macroCalendarScheduleCollectionWorkflowPolicy.httpStatusRangesByFailureCode[
    failureCode as keyof typeof macroCalendarScheduleCollectionWorkflowPolicy.httpStatusRangesByFailureCode
  ]
  if (!ranges || typeof status !== 'number' || !Number.isInteger(status)) return false
  return ranges.some((range) => status >= range.minimum && status <= range.maximum)
}

function isValidInput(input: MacroCalendarCollectionInput): boolean {
  return Boolean(input && typeof input === 'object') && typeof input.descriptorId === 'string' &&
    typeof input.runId === 'string' && input.runId.trim().length > 0 && isCanonicalUtcMillis(input.detectedAt)
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !macroCalendarScheduleHealthPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isHttpSuccess(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 299
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeFailureCount(value: unknown): number {
  return isNonNegativeSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? value : 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeDescriptorId(input: MacroCalendarCollectionInput): string {
  return typeof input?.descriptorId === 'string' ? input.descriptorId : 'unknown-descriptor'
}
