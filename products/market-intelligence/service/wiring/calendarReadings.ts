import type { DatabaseSync } from 'node:sqlite'

import type { JobRuntime } from '@platform/jobs'
import type { NotificationSubmitRequest } from '@platform/notifications'

import { marketCalendarPublicPolicy } from '../../contracts/macro/marketCalendarQueryContracts'
import { eventTypeNameByCode, nameByMetricKey } from '../intelligence/macro-calendar/marketCalendarCodeNames'
import { createStandardMonthPageReader } from '../intelligence/macro-calendar/marketCalendarStandardMonthPage'
import { readCalendarFreshnessFromJobRuns, readStandardTableLastWrittenAt } from '../intelligence/macro-calendar/marketCalendarFreshnessFromJobs'
import { zeroXRouterCalendarSchedulerFeeds, zeroXRouterCalendarSchedulerPolicy }
  from '../intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarScheduler'
import { createNarwhalCalendarBriefingRefresh } from '../intelligence/macro-calendar/narwhal-calendar/narwhalCalendarBriefingCatchUp'
import { registerCalendarEventReminder } from '../intelligence/macro-calendar/registerCalendarEventReminder'
import { registerCalendarIntegrityJob } from '../intelligence/macro-calendar/marketCalendarIntegrityJob'

import type { CalendarReminderSettingsStore } from '../intelligence/macro-calendar/calendarEventReminderSettingsStore'

import type { IntelligenceModule } from '../intelligence/intelligenceModule'

/**
 * 日历的**读侧**：标准表月查询 + 新鲜度 + 事件提醒 + 日报的补跑命令（方案 W5 的余下部分）。
 *
 * 三件事绑在同一次装配里，是因为它们共用同一个月读取器与同一个「最后写入时刻」：
 * 拆开会让两个读者各自算一次新鲜度，日报和日历页就会互相打架。
 *
 * **只搬不改**：新鲜度仍从作业记录算（`lastRunAt` 与 `lastCollectedAt` 分开）、
 * 补跑仍是「排一次 tick、最多等 20 秒、按终态回答」，提醒仍走同一份设置与同一个提交口。
 */
export function wireCalendarReadings(input: Readonly<{
  database: DatabaseSync
  jobRuntime: JobRuntime
  calendarReminderSettings: CalendarReminderSettingsStore
  intelligenceModule: IntelligenceModule
  submitNotification: (request: NotificationSubmitRequest) => Promise<unknown>
  timeZone: () => string
}>): Readonly<{
  standardCalendarReader: ReturnType<typeof createStandardMonthPageReader>
  calendarReminder: ReturnType<typeof registerCalendarEventReminder>
}> {
  // **S2：月查询改读标准表**（`mi_calendar_releases` 视图）。对外仍是 `MarketCalendarPage`，
  // 上面的分析与日报因此不用改一行。旧观测那条路径保留给新鲜度与证据观察，读数据不再经过它。
  // 来源由「行 → feed id」的映射算出来（适配器内），装配处不再保留那条
  // 「其余 → 0xRouter」的死分支——旧源删掉之后它会把认不出的 provider 说成一个不存在的来源。
  const standardCalendarReader = createStandardMonthPageReader({
    database: input.database,
    resolveTitle: (row) => {
      const metric = nameByMetricKey[row.metricKey]
      if (metric !== undefined) return metric.zhShort
      const event = eventTypeNameByCode[row.metricKey]
      if (event !== undefined) return event.zhShort
      return row.sourceLabel
    },
  })
  /**
   * **判定只读一个数**：标准表 `max(observed_at)`（用户 2026-11-16 定死）。
   * 曾经这里写着「新鲜度从作业记录算」，换源时那次 68 小时的误判就是照那段话实现的——
   * 作业会改名、会停跑，数据不会。注释与代码相反比死代码更危险，所以这段按实际写。
   */
  const readCalendarLastWrittenAt = () => readStandardTableLastWrittenAt(input.database)
  /**
   * **展示输入**：「最近一次采集尝试」（attempts 表，按当前三条描述符取最新一条）。
   * 它不参与判定，但必须真的喂进去——否则简报里「最近一次采集失败」那句话永远不出现，
   * 而且不报错、只会静默消失（能力在、喂输入的人不在，这种最难发现）。
   */
  const readLatestAttempts = (): readonly { descriptorId: string
    latestAttempt?: { attemptedAt: string; state: string } }[] => {
    try {
      const pick = input.database.prepare(`select descriptor_id, attempted_at, state
        from mi_macro_calendar_market_refresh_attempts where descriptor_id = ?
        order by attempted_at desc limit 1`)
      return marketCalendarPublicPolicy.descriptors.map((descriptorId) => {
        const row = pick.get(descriptorId) as { attempted_at?: string; state?: string } | undefined
        return { descriptorId, ...(row?.attempted_at === undefined || row.state === undefined
          ? {} : { latestAttempt: { attemptedAt: row.attempted_at, state: row.state } }) }
      })
    } catch { return [] }
  }
  input.intelligenceModule.publicQueryService.setMarketCalendarQuery({
    queryMonth: standardCalendarReader.queryMonth,
    // **判定只有一个数**：标准表 `max(observed_at)`；作业记录不参与（用户 2026-11-16 定死）。
    readCollectionFreshness: async () => readCalendarFreshnessFromJobRuns({
      lastWrittenAt: readCalendarLastWrittenAt(),
      latestAttempts: readLatestAttempts(),
      asOf: new Date().toISOString()
    })
  })
  // 「日历事件开始前」提醒：接线细节在独立模块里（bootstrap 的体积基线只许变小）。
  const calendarReminder = registerCalendarEventReminder({ jobRuntime: input.jobRuntime, settings: input.calendarReminderSettings,
    queryMonth: standardCalendarReader.queryMonth, submit: (request) => input.submitNotification(request), timeZone: () => input.timeZone() })
  // **数据一致性巡检**（用户 2026-11-19 定）：每天跑一次五项扫描，任一不为 0 就报出来。
  // 只读、零网络、不改数据；启动时的那一次盘点在 `syncOfficialStandardRowsAtStartup` 里。
  registerCalendarIntegrityJob(input.jobRuntime, {
    database: input.database,
    log: (line) => { console.log(JSON.stringify(line)) }
  })
  // The one calendar *command* the brief needs: a bounded catch-up before it judges freshness.
  // A command, not a query — it opens network requests and writes attempts — so it is injected
  // separately from the read surface above, and the brief never constructs a client of its own.
  // 日报的「跑一次采集」＝排一次 Narwhal tick（与 `triggerCollection` 同一条路）。
  // 旧源那条 `refreshNow` 会随它一起删；语义没变：排上作业才算触发，排不上就如实说失败。
  // 「排上了」不等于「采到了」：排完等作业到终态（最多 20 秒），按终态回答；超时就是超时，
  // 不写成失败。判 `collected` 与 `unchanged` 看**数据有没有真的写进来**，不看作业跑没跑。
  input.intelligenceModule.bindBriefingCalendarRefresh(createNarwhalCalendarBriefingRefresh({
    jobRuntime: input.jobRuntime,
    // **补采必须按**下发名单**排**（不是写死一路）：名单来自 `listSchedules()`，这里给出
    // sourceId → 作业定义的映射；名单里没有的源跳过，删源时这份映射自然变短。
    definitionId: `${zeroXRouterCalendarSchedulerPolicy.definitionId}.economic-data`,
    definitionForSourceId: (sourceId) => {
      const feed = zeroXRouterCalendarSchedulerFeeds.find((entry) => entry.sourceId === sourceId)
      return feed === undefined ? undefined : `${zeroXRouterCalendarSchedulerPolicy.definitionId}.${feed.key}`
    },
    readLastWrittenAt: readCalendarLastWrittenAt
  }))

  return Object.freeze({ standardCalendarReader, calendarReminder })
}
