import { MARKET_ANALYSIS_IPC_METHODS } from '../../../contracts/marketAnalysisIpcContracts'

const PRODUCT_ID = 'market-intelligence'
const CANONICAL_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const MAX_TEXT_LENGTH = 2_000

/** 运行状态闭集：与运行记录同形，渲染层只认这几档。 */
export const MARKET_ANALYSIS_RUN_STATUSES = [
  'queued', 'running', 'succeeded', 'invalid-output', 'failed', 'cancelled', 'stale', 'superseded'
] as const

export type MarketAnalysisRunStatus = (typeof MARKET_ANALYSIS_RUN_STATUSES)[number]

/** 一次运行「读者需要知道的那几件事」：状态、失败原因码（译文在文案表里映射）、起止时刻。 */
export type MarketAnalysisRunOutcome = Readonly<{
  id: string
  status: MarketAnalysisRunStatus
  failureCode: string | null
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
}>

/**
 * 读一次运行的结果。三种结果必须分得开：
 * - `available`：读到了（成功或失败都是事实）；
 * - `no-record`：运行记录不存在（老会话、或记录被清理）——这是事实，不是错误；
 * - `unreadable`：读失败——渲染层要给错误态与重试，不能画成空白、也不能说成「没有」。
 */
export type MarketAnalysisRunOutcomeLoad =
  | Readonly<{ state: 'available'; run: MarketAnalysisRunOutcome }>
  | Readonly<{ state: 'no-record' }>
  | Readonly<{ state: 'unreadable' }>

/**
 * 自动会话卡片用的一次读：只问「这次运行怎么样」，不读摘要与预测。
 *
 * 单独成一个模块，不挂在 `marketAnalysisTimelineClient` 上：那个文件已经顶在体积基线上，
 * 而这是个独立的读（一句 SQL 的投影），两件事不该挤在同一个文件里长。
 */
export async function loadMarketAnalysisRunOutcome(runId: string): Promise<MarketAnalysisRunOutcomeLoad> {
  try {
    const invoke = window.platform?.products?.invoke
    if (invoke === undefined) return { state: 'unreadable' }
    const value = await invoke(PRODUCT_ID, MARKET_ANALYSIS_IPC_METHODS.getAnalysisRun, { id: runId })
    return sanitizeRunOutcome(value)
  } catch (error) {
    // 记录不存在是**事实**（老会话、或记录被清理），不是读失败；其余才是读失败。
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('analysis-run-not-found') || message.includes('analysis-snapshot-not-found')) {
      return { state: 'no-record' }
    }
    return { state: 'unreadable' }
  }
}

function sanitizeRunOutcome(value: unknown): MarketAnalysisRunOutcomeLoad {
  const required = ['id', 'eventGroupId', 'analysisPhase', 'status', 'failureCode', 'queuedAt', 'startedAt', 'completedAt', 'asOf', 'dataCutoff', 'evidenceCount']
  if (!isRecordWithOptionals(value, required, ['change'])) return { state: 'unreadable' }
  const candidate = value
  if (!isText(candidate.id) || !MARKET_ANALYSIS_RUN_STATUSES.includes(candidate.status as MarketAnalysisRunStatus) ||
    (candidate.failureCode !== null && !isText(candidate.failureCode)) || !isCanonicalTime(candidate.queuedAt) ||
    (candidate.startedAt !== null && !isCanonicalTime(candidate.startedAt)) ||
    (candidate.completedAt !== null && !isCanonicalTime(candidate.completedAt))) return { state: 'unreadable' }
  return {
    state: 'available',
    run: {
      id: candidate.id as string,
      status: candidate.status as MarketAnalysisRunStatus,
      failureCode: (candidate.failureCode ?? null) as string | null,
      queuedAt: candidate.queuedAt as string,
      startedAt: (candidate.startedAt ?? null) as string | null,
      completedAt: (candidate.completedAt ?? null) as string | null
    }
  }
}

/** 精确键集校验（允许字段缺席）：多一个不该有的键就当作不可信，不渲染半张卡。 */
function isRecordWithOptionals(value: unknown, required: readonly string[], optional: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.every((name) => required.includes(name) || optional.includes(name)) &&
      required.every((field) => Object.getOwnPropertyDescriptor(value, field)?.enumerable === true)
  } catch {
    return false
  }
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH
}

function isCanonicalTime(value: unknown): value is string {
  if (!isText(value) || !CANONICAL_UTC_MILLIS.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}
