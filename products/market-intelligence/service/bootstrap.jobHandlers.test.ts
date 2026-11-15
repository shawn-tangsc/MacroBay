import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// bootstrap 的存储路径来自 `app.getPath('userData')`：这里给一个临时目录，不碰用户数据。
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'market-intelligence-job-handler-guard') },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import { createJobRuntime, type JobRuntime } from '@platform/jobs'
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
  'market-intelligence.refreshSentimentAggregates',
  'market-intelligence.reindex',
  'market-intelligence.replayWindow',
  'market-intelligence.retain-market-history',
  'market-intelligence.runMarketAnalysis',
  'market-intelligence.scoreNewsSentiment',
  'market-intelligence.translateItems',
  'market-intelligence.verifyMarketAnalysisPredictions',
]

beforeEach(() => {
  resetIntelligenceModuleForTests()
})

function bootAndCaptureHandlerIds(): readonly string[] {
  const runtime = createJobRuntime()
  const ids: string[] = []
  const spying: JobRuntime = {
    ...runtime,
    registerHandler: (handlerId, handler) => {
      ids.push(handlerId)
      runtime.registerHandler(handlerId, handler)
    }
  }
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
