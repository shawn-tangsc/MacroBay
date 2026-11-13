import type { JobRuntime } from '@platform/jobs'

import { createNarwhalCalendarRuntime } from './narwhalCalendarRuntime'
import type { NarwhalCalendarBatch } from './narwhalCalendarObservationBatches'
import { createNarwhalCalendarScheduler } from './narwhalCalendarScheduler'
import type { NarwhalHttpResult, NarwhalRequest } from './narwhalCalendarHttp'

/**
 * 装配零件：把「取凭据 → 发请求 → 采集/解析/入库 → 注册两条作业」包成一件，
 * 让 `bootstrap.ts` 只加三行（new、initialize、syncSchedule），不把日历细节塞进装配根。
 *
 * 凭据只在这一层读，读完就丢：不进日志、不进渲染层，也不缓存到别处。
 */
export const narwhalCalendarCredentialRef = 'macro-calendar-narwhal-economic-data-credentials'

export function createNarwhalCalendarAssembly(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  repository: Parameters<typeof createNarwhalCalendarRuntime>[0]['repository']
  /** 平台网络层（过代理）。装配处传 `getPlatformFetch()`，本模块不直接碰网络。 */
  fetchImpl: typeof fetch
  /** 凭据读取：与调度器同一条判据，装配处不要另判一套。 */
  getCredential: (credentialRef: string) => Promise<Readonly<{ apiKey?: string }> | null>
  now: () => number
  sleep?: (milliseconds: number) => Promise<void>
  countries?: readonly string[]
  /** 读者开关：`undefined` ＝ 仍锁着（pending 期间不参与判断）。 */
  readerEnabled?: () => boolean | undefined
  /** 把发布同时写成日历观测（走日历那张表的同一套写入校验）。 */
  appendObservationBatch?: (batch: NarwhalCalendarBatch) => void
}>) {
  // 读到的密钥只活在这个闭包里：`hasCredential()` 用它判注册，`request` 用它发请求。
  let apiKey: string | undefined

  async function loadCredential(): Promise<void> {
    try {
      const credential = await deps.getCredential(narwhalCalendarCredentialRef)
      apiKey = credential?.apiKey === undefined || credential.apiKey === '' ? undefined : credential.apiKey
    } catch {
      // 读不到凭据 ≠ 没有凭据：这里与「作业不注册」同一条处理，别把异常当成密钥错误。
      apiKey = undefined
    }
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
    now: deps.now,
    sleep: deps.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  })

  const scheduler = createNarwhalCalendarScheduler({
    jobRuntime: deps.jobRuntime,
    runtime,
    now: deps.now,
    hasCredential: () => apiKey !== undefined,
    ...(deps.readerEnabled === undefined ? {} : { readerEnabled: deps.readerEnabled }),
    ...(deps.countries === undefined ? {} : { countries: deps.countries })
  })

  return Object.freeze({
    /** 先读凭据再注册：顺序反了会「没有密钥却注册了作业」。 */
    async initialize(): Promise<void> {
      await loadCredential()
      scheduler.initialize()
    },
    /** 凭据/开关变化后重新对账；凭据变化要重新读一次。 */
    async syncSchedule(): Promise<void> {
      await loadCredential()
      scheduler.syncSchedule()
    },
    dispose(): void { scheduler.dispose() },
    runtime
  })
}
