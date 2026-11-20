import type { JobScheduleView } from '@platform/jobs'

/**
 * 「当前间隔 / 下次采集」这份读数：**数据从平台已有的调度投影来**，不新造一套。
 *
 * `jobRuntime.listSchedules()` 的只读投影（`JobScheduleView`）本来就带 `trigger.intervalMs`、
 * `nextRunAt`、`lastRunAt`、`lastRunStatus`；这里只做两件事：
 * 1. 把**作业 → 源**翻译成一份按 `sourceId` 索引的读数（映射不散落在渲染层）；
 * 2. 把它翻译成界面上的那一行（哪些状态、显示哪一段）。
 *
 * 口径（与原型 2026-11-13 一致）：
 * - **间隔与下次是两段独立事实**：一段读不到只影响那一段，不许整行消失、也不许拿 0 顶替；
 * - `nextRunAt` 是投影按「上次完成/开始 + 间隔」**推算**的，不是承诺时刻；
 * - 正在采集不给倒计时；从没跑过写「尚未开始」；排期里没有这个源写「未安排」且不显示间隔。
 */

/** 通用采集作业的 id 形状：`market-intelligence.collect:<sourceId>`（`sourceRuntimeOrchestrator.ts`）。 */
export const INTELLIGENCE_COLLECT_JOB_PREFIX = 'market-intelligence.collect:'

/** 一个源的调度事实。`registration: 'absent'` 表示这份投影里没有它的作业。 */
export type SourceCadenceReadout = Readonly<{
  registration: 'registered' | 'absent'
  mode: 'interval' | 'manual' | 'unscheduled'
  /** 秒。`null` = 这条作业的触发方式不是定时间隔（或没有作业）。 */
  intervalSeconds: number | null
  /** ISO-8601 UTC（`Z`）。`null` = 推不出下次（还没跑过 / 手动 / 触发不是间隔）。 */
  nextRunAt: string | null
  /** ISO-8601 UTC（`Z`）。`null` = 从来没有跑完过。 */
  lastRunAt: string | null
  /** 这一批运行时最后一次运行还在队列里或正在跑。 */
  running: boolean
}>

/**
 * 作业 → 源。只认通用采集作业的 id 前缀：产品自有作业（宏观市场 / DXY / 跨资产指数、
 * 0xRouter ETF 刷新）的源在界面上是「内置频率」，不画这一行，也就不需要映射。
 */
export function readSourceCadence(
  schedules: readonly JobScheduleView[]
): Readonly<Record<string, SourceCadenceReadout>> {
  const bySource: Record<string, SourceCadenceReadout> = {}
  for (const schedule of schedules) {
    if (!schedule.id.startsWith(INTELLIGENCE_COLLECT_JOB_PREFIX)) continue
    const sourceId = schedule.id.slice(INTELLIGENCE_COLLECT_JOB_PREFIX.length)
    if (sourceId === '') continue
    const intervalMs = schedule.trigger.kind === 'interval' ? schedule.trigger.intervalMs : null
    bySource[sourceId] = {
      registration: 'registered',
      mode: intervalMs === null ? 'unscheduled' : 'interval',
      intervalSeconds: intervalMs === null ? null : Math.round(intervalMs / 1_000),
      nextRunAt: schedule.nextRunAt,
      lastRunAt: schedule.lastRunAt,
      running: schedule.lastRunStatus === 'running' || schedule.lastRunStatus === 'queued'
    }
  }
  return bySource
}

/** 第二段（「·」之后）的形态。`at` 之外都是**不可判定**，各自有各自的说法。 */
export type FrequencyNext =
  | Readonly<{ kind: 'at'; instant: string }>
  | Readonly<{ kind: 'running' }>
  | Readonly<{ kind: 'notStarted' }>
  | Readonly<{ kind: 'unreadable' }>

/**
 * 读数这一行（浮层第①条）的状态集合。
 *
 * **原型 v4 里还有两态，这里刻意没有**（用户 2026-11-13 定，理由比「先不做」更硬：
 * 摆了拿不到数据的状态，等于先画界面、再让数据去凑）：
 * - `下次待排期`：`JobScheduleView` 里「已登记、没跑过、下次推不出」与「尚未开始」是**同一个形状**，
 *   要分开只能编一个假分支；
 * - `采集器离线`：`unavailable` 的源本来就不画这一行，`healthState` 的词义是「运行失败」不是「离线」。
 *
 * 两态都**等真有数据来源再加**，别照原型回来「补缺」；真接上时要先能区分，再一起补文案与用例。
 */
export type FrequencyReadoutView =
  /** 手动档：不自动采集，不写「—」也不写时刻。 */
  | Readonly<{ kind: 'manual' }>
  /** 源没启用：这一格本来就不采集。 */
  | Readonly<{ kind: 'disabled' }>
  /** 排期里没有它的作业：只写「未安排」，**不显示间隔**（不从开关反推）。 */
  | Readonly<{ kind: 'unscheduled' }>
  /** 整批调度投影这次读不到：这一行不画，ⓘ 里说明原因。 */
  | Readonly<{ kind: 'unreadable' }>
  /** 有间隔可读：第一段是间隔，第二段按 `next` 的几种事实分开。 */
  | Readonly<{ kind: 'interval'; intervalSeconds: number; next: FrequencyNext }>

export type FrequencyReadoutInput = Readonly<{
  /** 源自己的采集开关（投影值）。 */
  enabled: boolean
  /** 读者存的采集预设：`manual` 时底下不可能有作业，先判它。 */
  preset?: string
  /** 整批调度投影这次读没读到（桥缺失或调用失败）。 */
  scheduleAvailable: boolean
  /** 这个源的调度事实；`undefined` = 投影里没有它。 */
  cadence?: SourceCadenceReadout
}>

export function frequencyReadoutView(input: FrequencyReadoutInput): FrequencyReadoutView {
  if (!input.enabled) return { kind: 'disabled' }
  if (input.preset === 'manual') return { kind: 'manual' }
  if (!input.scheduleAvailable) return { kind: 'unreadable' }
  const cadence = input.cadence
  if (cadence === undefined || cadence.registration === 'absent') return { kind: 'unscheduled' }
  if (cadence.intervalSeconds === null) return { kind: 'unscheduled' }

  const intervalSeconds = cadence.intervalSeconds
  /* 顺序即优先级，每一条都有独立的数据来源：
     1. 正在采集（队列里或正在跑）：只换「下次」那一段，不给倒计时；
     2. 从没跑过：写「尚未开始」，不写「立即」也不编一个时刻；
     3. 跑过但推不出下次：写「下次时间读不到」；
     4. 其余：给推算出来的时刻（正文写「约」）。 */
  if (cadence.running) return { kind: 'interval', intervalSeconds, next: { kind: 'running' } }
  if (cadence.lastRunAt === null) return { kind: 'interval', intervalSeconds, next: { kind: 'notStarted' } }
  if (cadence.nextRunAt === null) return { kind: 'interval', intervalSeconds, next: { kind: 'unreadable' } }
  return { kind: 'interval', intervalSeconds, next: { kind: 'at', instant: cadence.nextRunAt } }
}
