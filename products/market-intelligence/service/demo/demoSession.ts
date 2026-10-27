/**
 * 示例模式的会话：一个只活在当前进程里的开关。
 *
 * 三件事：进入时暂停产品的采集调度（只暂停，不新增任何调度），退出时按既有 profile 恢复；
 * 活跃期间把「现在」钉在场景时钟上；把接口名映射到一份回放数据。
 *
 * 不写任何文件——重启即回到真实模式，这是「关闭就没了」的实现。
 */

import type { JobRuntime } from '@platform/jobs'

import type { SampleModeCatalog, SampleModeScenario } from './demoCatalog'
import { materializeSampleModePayload, readRequestAsOf } from './demoPayload'
import { tickSampleQuotes } from './demoTick'
import type { SampleModeLocale } from './demoScenario'

export type SampleModeUnavailableReason = 'no-scenario' | 'suspend-failed'

export type SampleModeView = Readonly<{
  active: boolean
  scenarioId?: string
  /** 示例模式下它就是「现在」。展示层只把它用于日期派生，不用于生成观测时间。 */
  scenarioNow?: string
  locale?: SampleModeLocale
  scenarioCount: number
  unavailableReason?: SampleModeUnavailableReason
}>

export type SampleModeSession = Readonly<{
  view: () => SampleModeView
  /** 读取一次场景目录，把 `scenarioCount` 提前暴露给控制面；不进入示例。 */
  prepare: () => Promise<SampleModeView>
  enter: (scenarioId?: string) => Promise<SampleModeView>
  exit: () => Promise<SampleModeView>
  now: () => Date
  /** 命中返回一份全新的回放体；未命中返回 `undefined`，由覆盖层决定报缺还是拒绝。 */
  lookup: (method: string, request: unknown) => unknown
  scenario: () => SampleModeScenario | undefined
}>

export type SampleModeSessionInput = Readonly<{
  productId: string
  loadCatalog: (locale: SampleModeLocale) => SampleModeCatalog
  getLanguage: () => Promise<SampleModeLocale>
  jobs: Pick<JobRuntime, 'listSchedules' | 'removeSchedule' | 'listRuns' | 'cancel'>
  /** 产品自己的额外暂停动作（可选）：调度之外的运行时，如果以后有，从这儿接。 */
  suspendWork?: () => Promise<void>
  /** 退出时按既有 profile 重新注册调度——复用启动编排，不新增调度逻辑。 */
  resumeWork: () => Promise<void>
  now?: () => Date
  /** 仅供测试：让「行情微动」可复现。 */
  random?: () => number
  log?: (line: Readonly<Record<string, unknown>>) => void
}>

export function createSampleModeSession(input: SampleModeSessionInput): SampleModeSession {
  const now = input.now ?? (() => new Date())
  const random = input.random ?? Math.random
  const log = input.log ?? (() => undefined)
  let active = false
  let scenario: SampleModeScenario | undefined
  let locale: SampleModeLocale | undefined
  let scenarioCount = 0
  let availabilityLoaded = false
  let preparing: Promise<SampleModeView> | undefined
  let entering = false
  let lastReason: SampleModeUnavailableReason | undefined

  const view = (): SampleModeView => ({
    active,
    ...(scenario ? { scenarioId: scenario.meta.id, scenarioNow: scenario.meta.scenarioNow } : {}),
    ...(locale ? { locale } : {}),
    scenarioCount,
    ...(!active && lastReason ? { unavailableReason: lastReason } : {})
  })

  async function prepare(): Promise<SampleModeView> {
    if (availabilityLoaded) return view()
    if (preparing) return preparing
    preparing = (async () => {
      try {
        const language = await input.getLanguage()
        const catalog = input.loadCatalog(language)
        scenarioCount = catalog.scenarios.length
        if (scenarioCount === 0) lastReason = 'no-scenario'
      } catch {
        lastReason = 'no-scenario'
      }
      availabilityLoaded = true
      return view()
    })()
    return preparing
  }

  async function suspend(): Promise<void> {
    const schedules = input.jobs.listSchedules().filter((definition) => definition.productId === input.productId)
    for (const definition of schedules) input.jobs.removeSchedule(definition.id)
    const running = input.jobs.listRuns({ productId: input.productId, statuses: ['running'] })
    for (const run of running) {
      try {
        input.jobs.cancel(run.id, { kind: 'cancelled', message: 'sample-mode' })
      } catch {
        // 取消失败不阻塞进入：调度已经摘掉，这次 run 最多把最后一次响应写完。
      }
    }
    await input.suspendWork?.()
    log({ marker: 'MI_SAMPLE_MODE_SUSPENDED', schedules: schedules.length, running: running.length })
  }

  return Object.freeze({
    view,
    prepare,
    scenario: () => scenario,
    now: () => (active && scenario ? new Date(scenario.meta.scenarioNow) : now()),
    async enter(scenarioId?: string) {
      // 已在示例中：语言可能刚被切换，重新解析一次场景（不重复暂停调度，也不重进）。
      if (active && scenario) {
        try {
          const language = await input.getLanguage()
          const reloaded = input.loadCatalog(language)
          const picked = reloaded.scenarios.find((candidate) => candidate.meta.id === scenario?.meta.id)
            ?? reloaded.scenarios[0]
          if (picked && picked.entries.size > 0) {
            scenario = picked
            locale = language
            scenarioCount = reloaded.scenarios.length
          }
        } catch {
          // 重新加载失败就继续用旧语言，不值得把读者踢出示例。
        }
        return view()
      }
      if (active) return view()
      if (entering) return view()
      entering = true
      lastReason = undefined
      try {
        const language = await input.getLanguage()
        const catalog = input.loadCatalog(language)
        scenarioCount = catalog.scenarios.length
        availabilityLoaded = true
        const picked = scenarioId
          ? catalog.scenarios.find((candidate) => candidate.meta.id === scenarioId)
          : catalog.scenarios[0]
        if (!picked || picked.entries.size === 0) {
          lastReason = 'no-scenario'
          log({ marker: 'MI_SAMPLE_MODE_ENTER_FAILED', reason: lastReason, scenarios: scenarioCount })
          return view()
        }
        try {
          await suspend()
        } catch (error) {
          lastReason = 'suspend-failed'
          log({ marker: 'MI_SAMPLE_MODE_ENTER_FAILED', reason: lastReason, message: String(error).slice(0, 160) })
          // 暂停失败时把已经摘掉的调度还回去，避免半开状态。
          await input.resumeWork().catch(() => undefined)
          return view()
        }
        scenario = picked
        locale = language
        active = true
        log({ marker: 'MI_SAMPLE_MODE_ENTERED', scenarioId: picked.meta.id, entries: picked.entries.size })
        return view()
      } finally {
        entering = false
      }
    },
    async exit() {
      if (!active) return view()
      active = false
      const previous = scenario?.meta.id
      scenario = undefined
      locale = undefined
      lastReason = undefined
      // 恢复失败意味着真实采集不会自己回来：重试一次，仍失败则留下明确的日志，而不是静默半停。
      let resumed = false
      for (let attempt = 0; attempt < 2 && !resumed; attempt += 1) {
        try {
          await input.resumeWork()
          resumed = true
        } catch (error) {
          if (attempt === 1) log({ marker: 'MI_SAMPLE_MODE_RESUME_FAILED', message: String(error).slice(0, 160) })
        }
      }
      log({ marker: 'MI_SAMPLE_MODE_EXITED', scenarioId: previous ?? null })
      return view()
    },
    lookup(method: string, request: unknown) {
      if (!active || !scenario) return undefined
      const entry = scenario.entries.get(method)
      if (!entry) return undefined
      const payload = entry.byRequest
        ? entry.byRequest[readByRequestKey(entry.byRequestKey, request)]
        : entry.payload
      if (payload === undefined) return undefined
      const materialized = echoRequestLocale(method, request, materializeSampleModePayload(payload, {
        ...(readRequestAsOf(request) ? { asOf: readRequestAsOf(request) } : {}),
        scenarioNow: scenario.meta.scenarioNow,
        wallNow: now()
      }))
      return method === 'intelligence.crossAsset.query'
        ? tickSampleQuotes(materialized, random)
        : materialized
    }
  })
}

/**
 * 市场日历页把自己的 `locale` 当作查询条件回显；示例里只有一份英文内容，
 * 所以这个字段跟随请求——否则中文界面会因为 `page.locale !== query.locale` 整页被丢弃。
 * 只改回显字段，事件内容一个字节都不动。
 */
function echoRequestLocale(method: string, request: unknown, payload: unknown): unknown {
  if (!method.endsWith('marketCalendar.queryMonth')) return payload
  if (!payload || typeof payload !== 'object') return payload
  if (!request || typeof request !== 'object') return payload
  const locale = (request as Record<string, unknown>).locale
  if (typeof locale !== 'string' || locale.length === 0) return payload
  return { ...(payload as Record<string, unknown>), locale }
}

function readByRequestKey(key: string | undefined, request: unknown): string {
  if (!key || !request || typeof request !== 'object') return ''
  const value = (request as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}
