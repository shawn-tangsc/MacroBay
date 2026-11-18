import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// bootstrap 的存储路径来自 `app.getPath('userData')`：这里给一个临时目录，不碰用户数据。
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'market-intelligence-job-handler-guard') },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import type { JobRuntime } from '@platform/jobs'
import { createEventBusRuntime } from '@platform/message-bus'

import { registerServices } from './bootstrap'
import { resetIntelligenceModuleForTests } from './intelligence/intelligenceModule'

/**
 * 第 0 笔守卫：**boot 级 job handler 表面快照**（架构师方案 §3 J6）。
 *
 * 为什么需要它：`registerHandler` 只在重复注册时抛；`setSchedule` 不校验 handler 存在；
 * 只有 `enqueue*` 才会发现「这个 id 没有 handler」。所以拆分时少搬一处注册，
 * 要到那个作业第一次跑才炸——可能是几小时后。IPC 那一面有 `seal()` 的 87 条硬判据兜着，
 * job handler 这一面今天什么都没有。
 *
 * 做法：包一层真 `createJobRuntime()`，只拦 `registerHandler` 记 id，然后断言**排序后的集合逐字相等**。
 * 任何一处注册被漏掉/改名，这条就红，而且直接点出少了哪一个。
 */
/**
 * **覆盖边界（读这条守卫的人先看这段）**：
 * 它只断言「注册到 **boot 主 job runtime** 上的 handler 集合」。`sourceRuntimeOrchestrator.ts:6` 的
 * `market-intelligence.streamWorker` 注册在 **worker runtime** 上，不在下面这 29 个里——
 * 这里全绿不等于「全产品 handler 一个不少」，那条另一处另有它的守卫。
 *
 * **这条用例不干活**：`jobRuntime` 用的是**不调度任何作业的替身**（`setSchedule` / `enqueue*` 都是空实现），
 * 所以它不会真的跑一次采集、不发网请求、不写用户库；存储路径也被 `electron` 的
 * `app.getPath` 指到临时目录。曾经用真 `createJobRuntime()` 时，它在装配过程中触发过一条
 * `[macro-calendar] … parser-output-empty` 的采集失败日志——网络一抖这条守卫就会 flaky，故改为替身。
 *
 * 装配过程本身还会打一条 `[macro-calendar] 官方发布入标准表：… 读到 0 条、写入 0 条`：
 * 那是启动时的标准表同步，读写的库在**临时目录**、`platformFetch` 是 `vi.fn()`（永不发真请求），
 * 所以它不碰用户数据、不依赖网络；这条断言也不看它的结果。
 */
function inertJobRuntime(onRegister: (handlerId: string) => void): JobRuntime {
  return {
    registerHandler: (handlerId: string) => { onRegister(handlerId) },
    setSchedule: () => undefined,
    removeSchedule: () => undefined,
    listSchedules: () => [],
    /* 下面这些在装配阶段不会被调用；真调到了也不许真跑作业——直接抛，让「装配顺手跑一次采集」当场暴露。 */
    enqueueManual: async () => { throw new Error('guard: enqueueManual is not allowed while snapshotting handlers') },
    enqueueStartup: async () => { throw new Error('guard: enqueueStartup is not allowed while snapshotting handlers') },
    enqueueDefinition: async () => { throw new Error('guard: enqueueDefinition is not allowed while snapshotting handlers') },
    waitForRunTerminal: async () => ({ state: 'timeout' }),
    cancel: () => undefined,
    getRun: () => undefined,
    listRecentRuns: () => [],
    listRuns: () => [],
    listRunPage: () => ({ items: [], nextCursor: undefined }),
    listRunAggregates: () => ({ state: 'unavailable', reasonCode: 'run-history-unavailable' }),
    recover: () => [],
    stopAll: () => undefined,
    createQueuedRun: () => { throw new Error('guard: createQueuedRun is not allowed while snapshotting handlers') },
    markRunningForTest: () => undefined
  } as unknown as JobRuntime
}

const EXPECTED_HANDLER_IDS: readonly string[] = [
  'market-intelligence.analysisSessionSlots',
  'market-intelligence.archiveCompaction',
  'market-intelligence.assessChangedItems',
  'market-intelligence.calendar-event-reminder',
  'market-intelligence.collect-cross-asset-index',
  'market-intelligence.collect-macro-market',
  'market-intelligence.collect-policy-path',
  'market-intelligence.collect-realmarketapi-dxy',
  'market-intelligence.collectSource',
  'market-intelligence.dailyBriefing',
  'market-intelligence.enrichNewsDocuments',
  'market-intelligence.freezeMarketAnalysisSnapshot',
  'market-intelligence.groupMarketAnalysisChange',
  'market-intelligence.normalizeRawRecords',
  'market-intelligence.parquetExport',
  'market-intelligence.purge',
  'market-intelligence.recoverMarketAnalysisRuns',
  'market-intelligence.reevaluateClusters',
  'market-intelligence.reevaluateSentimentScopes',
  'market-intelligence.refreshBeaOfficialReleases',
  'market-intelligence.refreshMacroCalendar',
  // 0xrouter 三路日历：每条 feed 一个定义（2026-11-16 接回装配；此前全仓没有生产调用点，
  // 所以「设置里打开了」并不等于「有作业在跑」）。
  'market-intelligence.refreshMarketCalendar.central-bank-activities',
  'market-intelligence.refreshMarketCalendar.economic-data',
  'market-intelligence.refreshMarketCalendar.financial-events',
  'market-intelligence.refreshSentimentAggregates',
  'market-intelligence.reindex',
  'market-intelligence.replayWindow',
  'market-intelligence.retain-market-history',
  'market-intelligence.runMarketAnalysis',
  'market-intelligence.scoreNewsSentiment',
  // 分析线的收尸作业（`SWEEP_STALLED_ANALYSIS_RUNS_JOB`）：它确实在注册面上，
  // 快照没登记就会红——补上是让快照与注册面一致，不是放宽断言。
  'market-intelligence.sweepStalledAnalysisRuns',
  'market-intelligence.translateItems',
  'market-intelligence.verifyMarketAnalysisPredictions',
]

beforeEach(() => {
  resetIntelligenceModuleForTests()
})

function bootAndCaptureHandlerIds(): readonly string[] {
  const ids: string[] = []
  const spying = inertJobRuntime((handlerId) => ids.push(handlerId))
  registerServices({
    getTimeZone: () => 'Asia/Shanghai',
    register: () => undefined,
    jobRuntime: spying,
    eventBusRuntime: createEventBusRuntime(),
    registerProductAgentToolHandler: vi.fn(),
    registerProductCache: vi.fn(),
    platformFetch: vi.fn(async () => '{}' as never)
  })
  return Object.freeze([...ids].sort())
}

describe('boot 级 job handler 表面快照', () => {
  it('registers exactly this set of job handlers', () => {
    const actual = bootAndCaptureHandlerIds()
    // 失败信息直接点出「少了谁 / 多了谁」，而不是只报长度不等。
    const missing = EXPECTED_HANDLER_IDS.filter((id) => !actual.includes(id))
    const extra = actual.filter((id) => !EXPECTED_HANDLER_IDS.includes(id))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    expect(actual).toEqual([...EXPECTED_HANDLER_IDS])
  })
})
