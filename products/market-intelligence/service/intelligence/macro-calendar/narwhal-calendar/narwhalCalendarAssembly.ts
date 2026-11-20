import type { JobRuntime } from '@platform/jobs'

import { createNarwhalCalendarRuntime } from './narwhalCalendarRuntime'
import type { NarwhalCalendarBatch, NarwhalStandardRowInput } from './narwhalCalendarObservationBatches'
import { createNarwhalCalendarScheduler } from './narwhalCalendarScheduler'
import type { NarwhalHttpResult, NarwhalRequest } from './narwhalCalendarHttp'
import type { CalendarUnmappedReason } from '../marketCalendarStandardTable'

/**
 * 装配零件：把「取凭据 → 发请求 → 采集/解析/入库 → 注册两条作业」包成一件，
 * 让 `bootstrap.ts` 只加三行（new、initialize、syncSchedule），不把日历细节塞进装配根。
 *
 * 凭据只在这一层读，读完就丢：不进日志、不进渲染层，也不缓存到别处。
 */
export const narwhalCalendarCredentialRef = 'macro-calendar-narwhal-economic-data-credentials'

export function createNarwhalCalendarAssembly(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition' | 'listRuns'>
  repository: Parameters<typeof createNarwhalCalendarRuntime>[0]['repository']
  /** 平台网络层（过代理）。装配处传 `getPlatformFetch()`，本模块不直接碰网络。 */
  fetchImpl: typeof fetch
  /** 凭据读取：与调度器同一条判据，装配处不要另判一套。 */
  getCredential: (credentialRef: string) => Promise<Readonly<{ apiKey?: string }> | null>
  /**
   * 诊断日志（默认 `console.warn`）。**「读不到凭据」与「没有凭据」是两件事**：
   * 后者是读者的选择、安静；前者是故障，必须留下一条能查到原因的记录。
   */
  log?: (event: 'credential-unreadable' | 'credential-absent' | 'schedule-recovered', detail?: string) => void
  /** 启动后重试排期的间隔与次数（测试可注入小值）。 */
  retryPolicy?: Readonly<{ intervalMs: number; attempts: number }>
  now: () => number
  sleep?: (milliseconds: number) => Promise<void>
  countries?: readonly string[]
  /** 读者开关：`undefined` ＝ 仍锁着（pending 期间不参与判断）。 */
  readerEnabled?: () => boolean | undefined
  /** 采集前的门：源还锁着（`pending`）或读者关掉 → 这轮不采。 */
  readSourceGate?: () => Promise<Readonly<{ visibility: string; enabled: boolean }> | undefined>
  /** 按 measure 拆行的标准行（S1 双写用）：一次采集给一次，与语言无关。 */
  appendStandardRows?: (rows: readonly NarwhalStandardRowInput[],
    unmapped: readonly Readonly<{ sourceKey: string; name: string; reason: CalendarUnmappedReason
      measureKeys?: readonly string[] }>[],
    sourceTotals: Readonly<{ releases: number; measures: number; measuresOnEventReleases: number }>) => void
  /** 把发布同时写成日历观测（走日历那张表的同一套写入校验）。 */
  appendObservationBatch?: (batch: NarwhalCalendarBatch) => void
}>) {
  // 读到的密钥只活在这个闭包里：`hasCredential()` 用它判注册，`request` 用它发请求。
  let apiKey: string | undefined
  /** 凭据读取的**结论**：`absent`（读者没配）与 `unreadable`（读失败）必须分开。 */
  let credentialState: 'unknown' | 'ready' | 'absent' | 'unreadable' = 'unknown'
  const log = deps.log ?? ((event, detail) => console.warn(`[macro-calendar] narwhal ${event}${detail === undefined ? '' : `: ${detail}`}`))

  async function loadCredential(): Promise<void> {
    try {
      const credential = await deps.getCredential(narwhalCalendarCredentialRef)
      const key = credential?.apiKey
      apiKey = key === undefined || key === '' ? undefined : key
      credentialState = apiKey === undefined ? 'absent' : 'ready'
    } catch (error) {
      // 读不到凭据 ≠ 没有凭据：作业同样不注册（fail-closed），但**必须留下原因**，
      // 而且要能被启动后的重试重新排上——否则一次早到的读失败会把采集静默停掉一整轮。
      apiKey = undefined
      credentialState = 'unreadable'
      log('credential-unreadable', error instanceof Error ? error.message : undefined)
    }
  }

  const retryPolicy = deps.retryPolicy ?? { intervalMs: 5_000, attempts: 6 }
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAttempts = 0
  /** 启动后因为没凭据而没排上过：恢复时要记一条，读者/排障才知道「它自己回来了」。 */
  let startedWithoutSchedule = false

  /**
   * 凭据/开关晚到之后的自愈：再读一次凭据与档案，然后重新对账排期。
   * 成功排上就停；用尽次数后把「没有凭据」与「读不到凭据」分别记一条，不留空白。
   */
  async function retryScheduling(): Promise<void> {
    await loadCredential()
    await refreshGate()
    scheduler.syncSchedule()
    if (apiKey !== undefined) {
      if (startedWithoutSchedule) log('schedule-recovered')
      startedWithoutSchedule = false
      retryAttempts = 0
      return
    }
    retryAttempts += 1
    if (retryAttempts >= retryPolicy.attempts) {
      if (credentialState === 'absent') log('credential-absent')
      retryAttempts = 0
      return
    }
    retryTimer = setTimeout(() => { void retryScheduling() }, retryPolicy.intervalMs)
    retryTimer.unref?.()
  }

  function startRetryIfNeeded(): void {
    if (apiKey !== undefined || retryTimer !== undefined) return
    retryAttempts = 0
    startedWithoutSchedule = true
    retryTimer = setTimeout(() => { void retryScheduling() }, retryPolicy.intervalMs)
    retryTimer.unref?.()
  }

  const request: NarwhalRequest = async ({ url, headers }) => {
    try {
      const response = await deps.fetchImpl(url, { headers })
      const text = await response.text()
      const out: Record<string, string> = {}
      response.headers.forEach((value, key) => { out[key.toLowerCase()] = value })
      let body: unknown = text
      try { body = JSON.parse(text) } catch { /* keep text */ }
      const result: NarwhalHttpResult = { status: response.status, headers: out, body }
      return result
    } catch {
      return { status: 0, headers: {}, body: null }
    }
  }

  const runtime = createNarwhalCalendarRuntime({
    request,
    readApiKey: () => apiKey,
    repository: deps.repository,
    ...(deps.appendObservationBatch === undefined ? {} : { appendObservationBatch: deps.appendObservationBatch }),
    ...(deps.appendStandardRows === undefined ? {} : { appendStandardRows: deps.appendStandardRows }),
    now: deps.now,
    sleep: deps.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  })

  // 读者开关的**同步缓存**：调度器判定注册是同步的，而档案是异步读的，
  // 所以在 initialize / syncSchedule 里读一次、存成布尔，之后调度器直接问缓存。
  let readerEnabledCache: boolean | undefined
  let gateRead = false
  let gateMissingReported = false
  async function refreshGate(): Promise<void> {
    const gate = await deps.readSourceGate?.()
    gateRead = true
    readerEnabledCache = gate === undefined ? undefined
      : gate.visibility === 'pending' || gate.visibility === 'hidden' ? false : gate.enabled
  }

  const scheduler = createNarwhalCalendarScheduler({
    jobRuntime: deps.jobRuntime,
    runtime,
    now: deps.now,
    ...(deps.readSourceGate === undefined ? {} : { readSourceGate: deps.readSourceGate }),
    hasCredential: () => apiKey !== undefined,
    // 读者关掉 → `removeSchedule`（不是空转）；再打开 → 重新注册。判据就是缓存里的那个布尔。
    // **fail-closed**：缓存没初始化（还没读过档）按「关」处理，不按「开」——宁可晚一轮，
    // 也不许在读者档案还没读到的时候先替他答应。
    readerEnabled: () => {
      // 还没读过档就问「读者开没开」＝装配顺序错了（或门没注入）。按「关」处理，并说一次。
      if (!gateRead && !gateMissingReported) {
        gateMissingReported = true
        console.warn('[macro-calendar] 读者开关档案尚未读取，先按关闭处理（不采）')
      }
      return readerEnabledCache === true
    },
    ...(deps.readerEnabled === undefined ? {} : { readerEnabled: deps.readerEnabled }),
    ...(deps.countries === undefined ? {} : { countries: deps.countries })
  })

  return Object.freeze({
    /** 先读凭据再注册：顺序反了会「没有密钥却注册了作业」。 */
    async initialize(): Promise<void> {
      await loadCredential()
      await refreshGate()
      scheduler.initialize()
      // 启动那一刻凭据可能还没就绪（存储没装好、或这次读失败）：先 fail-closed 不排，
      // 再自己回来重试——不能指望「下一次重启」或读者的手动保存来救。
      startRetryIfNeeded()
    },
    /** 凭据/开关变化后重新对账；凭据变化要重新读一次。 */
    async syncSchedule(): Promise<void> {
      await loadCredential()
      await refreshGate()
      scheduler.syncSchedule()
    },
    dispose(): void {
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      retryTimer = undefined
      scheduler.dispose()
    },
    /** 测试与「凭据保存后」的显式入口：读一次凭据再对账（不清定时器，重试会自己停）。 */
    async reconcile(): Promise<void> {
      await loadCredential()
      await refreshGate()
      scheduler.syncSchedule()
    },
    /** 只读：凭据读取的结论（`absent` 与 `unreadable` 分开），供状态面与用例断言。 */
    credentialState(): 'unknown' | 'ready' | 'absent' | 'unreadable' { return credentialState },
    runtime
  })
}
