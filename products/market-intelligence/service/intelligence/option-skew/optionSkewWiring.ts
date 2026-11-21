import { join } from 'node:path'

import type { JobRuntime } from '@platform/jobs'

import { createDeribitOptionsClient } from './deribitOptionsClient'
import { createOptionSkewPointStore, type OptionSkewStoreRead } from './optionSkewPointStore'
import { OPTION_SKEW_COLLECT_JOB_ID } from './optionSkewJobId'
import { createOptionSkewRuntime } from './optionSkewRuntime'

/**
 * 期权偏斜采集的**唯一装配点**：创建存储与运行时，把读口接给公开查询、把探针接给「测试连接」。
 *
 * 三条纪律写在这里，别处不再各写一份：
 * - 先把磁盘读进内存再启动运行时：反过来会拿空状态覆盖已存的历史日；
 * - `fetch` 只走平台代理（`platformFetch`）——给全局 fetch 会绕开代理，在需要代理的机器上静默失败；
 * - 读口只在加载成功后接上：加载失败就是「读不到」，不是「没有」。
 */
export type OptionSkewWiring = Readonly<{
  /**
   * 读者拨开关后调它：按源 profile 排期或撤期。加载完成前调用会被排队，不会丢。
   * `collectNow` 只在「拨开」那一侧传：拨开就先跑一轮（这一轮就是真探测）。
   */
  sync: (options?: Readonly<{ collectNow?: boolean }>) => void
}>

export function wireOptionSkew(deps: {
  jobRuntime: JobRuntime
  platformFetch: typeof fetch
  dataDir: string
  isEnabled: () => Promise<boolean>
  onReady: (parts: Readonly<{
    readSnapshot: () => OptionSkewStoreRead
    /** 与 `OptionSkewRuntime['probe']` 同一形状（`failureCode` 是字符串码，由卡侧映射成句子）。 */
    probe: () => Promise<Readonly<{ state: 'available' } | { state: 'unavailable'; failureCode: string }>>
  }>) => void
}): OptionSkewWiring {
  const store = createOptionSkewPointStore({ filePath: join(deps.dataDir, 'option-skew-points.json') })
  const runtime = createOptionSkewRuntime({
    jobRuntime: deps.jobRuntime,
    store,
    client: createDeribitOptionsClient({ fetch: (url, init) => deps.platformFetch(url, init) }),
    isEnabled: deps.isEnabled
  })
  const ready = store.load()
    .then(async () => {
      deps.onReady({ readSnapshot: () => store.readSnapshot(), probe: () => runtime.probe() })
      runtime.start()
      // 启动时按已存的开关排期：只等开关事件的话，重启后源会显示「未注册自动任务」。
      await runtime.sync()
    })
    .catch(() => undefined)
  return {
    sync: (options?: Readonly<{ collectNow?: boolean }>) => {
      void ready.then(async () => {
        await runtime.sync()
        // 「拨开就采一轮」：一轮本身就是真探测，连不上时由运行时记下失败，界面如实显示需要代理。
        if (options?.collectNow === true && (await deps.isEnabled())) {
          await deps.jobRuntime.enqueueManual(OPTION_SKEW_COLLECT_JOB_ID)
        }
      })
    }
  }
}