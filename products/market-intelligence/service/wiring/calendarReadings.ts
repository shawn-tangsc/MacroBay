import type { DatabaseSync } from 'node:sqlite'

import type { JobRuntime } from '@platform/jobs'
import type { NotificationSubmitRequest } from '@platform/notifications'

import { marketCalendarPublicPolicy } from '../../contracts/macro/marketCalendarQueryContracts'
import { eventTypeNameByCode, nameByMetricKey, registeredSourceIdentityName }
  from '../intelligence/macro-calendar/marketCalendarCodeNames'
import { createStandardMonthPageReader } from '../intelligence/macro-calendar/marketCalendarStandardMonthPage'
import { readCalendarFreshnessFromJobRuns, readStandardTableLastWrittenAt } from '../intelligence/macro-calendar/marketCalendarFreshnessFromJobs'
import { zeroXRouterCalendarSchedulerFeeds, zeroXRouterCalendarSchedulerPolicy }
  from '../intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarScheduler'
import { createMarketCalendarBriefingRefresh } from '../intelligence/macro-calendar/macroCalendarBriefingCatchUp'
import { createCalendarInterpretationGenerator } from '../intelligence/macro-calendar/interpretation/calendarEventInterpretationGenerator'
import { createMacroCalendarInterpretationService, type MacroCalendarInterpretationService }
  from '../intelligence/macro-calendar/macroCalendarEventInterpretationService'
import { registerCalendarEventInterpretationBackfill } from '../intelligence/macro-calendar/interpretation/calendarEventInterpretationBackfillJob'
import { registerCalendarEventReminder } from '../intelligence/macro-calendar/registerCalendarEventReminder'
import { registerCalendarIntegrityJob } from '../intelligence/macro-calendar/marketCalendarIntegrityJob'
import { latestCurrentWriteFailure, type CalendarStandardWriteLayer }
  from '../intelligence/macro-calendar/calendarStandardWriteLayer'

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
/**
 * **标准表行的标题（按 locale）**（用户 2026-11-20）：原来装配处写死 `zhShort`，界面切英文后
 * 数据侧仍给中文。码表每条都有 `enShort`，取它即可；**返回值 `undefined` 表示「名表里没有」**，
 * 由适配器的回退链接手（英文不许出中文原文名）。
 *
 * 导出成具名函数只为一个理由：**让用例直接调它**，而不是在测试里复刻一遍规则——
 * 复刻的规则一旦和线上分叉，用例仍然全绿（今晚已经出现过这种「代码对了没人守」）。
 */
export function resolveStandardRowTitle(
  row: Readonly<{ metricKey: string; seriesId?: string }>,
  locale: 'zh' | 'en',
  tables: Readonly<{
    metric: typeof nameByMetricKey
    event: typeof eventTypeNameByCode
    /** 源内身份的登记表（第三档，默认用唯一登记处）；参数是**源的稳定指标 id**。 */
    identity?: (seriesId: string | undefined) => Readonly<{ zh: string; en: string }> | undefined
  }> = { metric: nameByMetricKey, event: eventTypeNameByCode, identity: registeredSourceIdentityName }
): string | undefined {
  const metric = tables.metric[row.metricKey]
  if (metric !== undefined) return locale === 'en' ? metric.enShort : metric.zhShort
  const event = tables.event[row.metricKey]
  if (event !== undefined) return locale === 'en' ? event.enShort : event.zhShort
  /**
   * **第三档：登记过的源内身份**（没有指标码的数组身份行）。
   *
   * 键是**源的稳定指标 id**（`series_id`），不是身份第一段：第一段每次发布都换一个，
   * 拿它查登记永远落空（真库 1943 行对应 1544 个第一段）。这张表原来还只有「事件清单」页在用，
   * 日历月视图根本不查——同一行在两处两个名字。判据只问「这一条登记了没有」：登记了用我们
   * 起的名；没登记返回 `undefined`，由适配器回退源原文名（**绝不拿源原文冒充「我们起的名字」**）。
   */
  const identity = (tables.identity ?? registeredSourceIdentityName)(row.seriesId)
  if (identity !== undefined) return locale === 'en' ? identity.en : identity.zh
  return undefined
}

export function wireCalendarReadings(input: Readonly<{
  database: DatabaseSync
  jobRuntime: JobRuntime
  calendarReminderSettings: CalendarReminderSettingsStore
  intelligenceModule: IntelligenceModule
  submitNotification: (request: NotificationSubmitRequest) => Promise<unknown>
  timeZone: () => string
  /** 产品日志口（主进程 stdout 不进 `app.log`，要留痕必须走它）。 */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  /** 写入层（用户 2026-11-19）：freshness 的 `writeFailure` 从它取值，不再从健康 revision。 */
  writeLayer?: Pick<CalendarStandardWriteLayer, 'all'>
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
    // 装配处只转调这一行——取名规则在 `resolveStandardRowTitle` 里，用例直接调它。
    resolveTitle: (row, locale) => resolveStandardRowTitle(row, locale),
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
      return marketCalendarPublicPolicy.collectionFeeds.map((descriptorId) => {
        const row = pick.get(descriptorId) as { attempted_at?: string; state?: string } | undefined
        return { descriptorId, ...(row?.attempted_at === undefined || row.state === undefined
          ? {} : { latestAttempt: { attemptedAt: row.attempted_at, state: row.state } }) }
      })
    } catch { return [] }
  }
  input.intelligenceModule.publicQueryService.setMarketCalendarQuery({
    queryMonth: standardCalendarReader.queryMonth,
    // **判定只有一个数**：标准表 `max(observed_at)`；作业记录不参与（用户 2026-11-16 定死）。
    readCollectionFreshness: async () => {
      const writeFailure = input.writeLayer === undefined ? undefined : latestCurrentWriteFailure(input.writeLayer)
      return readCalendarFreshnessFromJobRuns({
        lastWrittenAt: readCalendarLastWrittenAt(),
        latestAttempts: readLatestAttempts(),
        asOf: new Date().toISOString(),
        ...(writeFailure === undefined ? {} : {
          lastWriteFailure: { at: writeFailure.at, firstErrorCode: writeFailure.code,
            ...(writeFailure.lastSuccessAt === undefined ? {} : { lastSuccessAt: writeFailure.lastSuccessAt }) }
        })
      })
    }
  })
  // 「日历事件开始前」提醒：接线细节在独立模块里（bootstrap 的体积基线只许变小）。
  const calendarReminder = registerCalendarEventReminder({ jobRuntime: input.jobRuntime, settings: input.calendarReminderSettings,
    queryMonth: standardCalendarReader.queryMonth, submit: (request) => input.submitNotification(request), timeZone: () => input.timeZone() })
  // **数据一致性巡检**（用户 2026-11-19 定）：每天跑一次五项扫描，任一不为 0 就报出来。
  // 只读、零网络、不改数据；启动时的那一次盘点在 `syncOfficialStandardRowsAtStartup` 里。
  registerCalendarIntegrityJob(input.jobRuntime, {
    database: input.database,
    log: (line) => { console.log(JSON.stringify(line)) },
    // 注册那一行要能在 `app.log` 里 grep 到（用户 2026-11-19）：两个口都写。
    announce: (message) => {
      input.log?.('info', 'macro-calendar.job-registered', { message })
      console.warn(message)
    }
  })
  // The one calendar *command* the brief needs: a bounded catch-up before it judges freshness.
  // A command, not a query — it opens network requests and writes attempts — so it is injected
  // separately from the read surface above, and the brief never constructs a client of its own.
  // 日报的「跑一次采集」＝按 `sourceIds` 逐个排 0xRouter 三路的作业（与 `triggerCollection` 同一条路）。
  // 语义没变：排上作业才算触发，排不上就如实说失败。
  // 「排上了」不等于「采到了」：排完等作业到终态（最多 20 秒），按终态回答；超时就是超时，
  // 不写成失败。判 `collected` 与 `unchanged` 看**数据有没有真的写进来**，不看作业跑没跑。
  input.intelligenceModule.bindBriefingCalendarRefresh(createMarketCalendarBriefingRefresh({
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

/**
 * 装配「事件解读」（R36 #34 第二半）：用哪份库、哪个模型实例、哪个读口。
 *
 * 放在这里而不是 `bootstrap.ts`：主装配文件已经过 500 行，接线上限只许降；
 * 判据与文案都不在这里（`macroCalendarEventInterpretationService` 负责）。
 * **模型实例共用情报模块那一个**：`maxConcurrent` 是每实例的闸，另建一份会让两条线互相看不见。
 */
export function wireMacroCalendarEventInterpretation(deps: Readonly<{
  repository: Pick<import('../intelligence/macro-calendar/macroCalendarRepository').MacroCalendarRepository, 'getEffectiveEventAsOf' | 'listEffectiveMonthAsOf'>
  database: DatabaseSync
  invoke: Parameters<typeof createCalendarInterpretationGenerator>[0]['invoke']
  now?: () => string
  /** 用量计数落一行结构化日志（仓库里没有用量报告设施，报告按这个 marker 聚合）。 */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  /** 高档自动补生成：没有作业运行时就不注册（测试与演示装配可以不排作业）。 */
  jobRuntime?: Parameters<typeof registerCalendarEventInterpretationBackfill>[0]
  readLocale?: () => Promise<'zh-CN' | 'en-US'>
}>): MacroCalendarInterpretationService {
  const now = deps.now ?? (() => new Date().toISOString())
  const interpretation = createMacroCalendarInterpretationService({
    repository: deps.repository, database: deps.database,
    generator: createCalendarInterpretationGenerator({
      database: deps.database, now, invoke: deps.invoke,
      count: (line) => deps.log?.('info', 'MI_CALENDAR_INTERPRETATION_USAGE', { ...line })
    }),
    now
  })
  // 「实际值落库后自动生成一次」的自动那半：按轮扫已发布的高档行，一轮有上限。
  if (deps.jobRuntime !== undefined && deps.readLocale !== undefined) {
    registerCalendarEventInterpretationBackfill(deps.jobRuntime, {
      repository: deps.repository, interpretation, now, readLocale: deps.readLocale
    })
  }
  return interpretation
}
