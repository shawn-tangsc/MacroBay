import { useEffect, useRef, useState } from 'react'

import type { JobScheduleView } from '@platform/jobs'
import type { LocalizedText } from '@platform/product-manifest'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

/**
 * 有界超时：preload 桥存在但调用挂起（IPC 不返回）时，也必须收敛到 error，
 * 不能停在「正在加载资源任务…」。默认 8s 只影响失败路径，成功路径不会变慢。
 */
export const RESOURCE_JOB_SCHEDULES_TIMEOUT_MS = 8_000

export type ResourceJobSchedulesErrorReason = 'bridge-missing' | 'read-failed' | 'timeout'

export type ResourceJobSchedulesController = {
  loading: boolean
  error: boolean
  /** 区分「读取失败」「缺少接口（多半是旧 preload / 未重启）」「读取超时」的原因码。 */
  errorReason: ResourceJobSchedulesErrorReason | null
  items: JobScheduleView[]
  /** 产品显示名（productId → name）；拿不到时留空，由页面回退到产品 id。 */
  productNames: Record<string, string>
  reload: () => Promise<void>
}

type ProductSummaryLike = { id: string; name: LocalizedText }

type ResourceJobBridge = {
  listSchedules: () => Promise<JobScheduleView[]>
  /** 产品摘要只提供显示名，缺了也照常列出调度。 */
  getProductSummaries: (() => Promise<ProductSummaryLike[]>) | null
}

type PlatformBridgeShape = {
  jobs?: { listSchedules?: unknown }
  app?: { getProductSummaries?: unknown }
}

/**
 * 读取 preload 桥。只做属性存在性检查，不调用任何方法，保证自身不会同步抛。
 * 返回 null 表示 `window.platform.jobs.listSchedules` 缺失（旧 preload / 未重启应用）。
 */
function readResourceJobBridge(): ResourceJobBridge | null {
  const platform = (window as unknown as { platform?: PlatformBridgeShape }).platform
  const jobs = platform?.jobs
  if (!jobs || typeof jobs.listSchedules !== 'function') return null
  const listSchedules = jobs.listSchedules as () => Promise<JobScheduleView[]>
  const summaries = platform?.app?.getProductSummaries
  const getProductSummaries = typeof summaries === 'function'
    ? (summaries as () => Promise<ProductSummaryLike[]>)
    : null
  return {
    listSchedules: () => listSchedules.call(jobs),
    getProductSummaries: getProductSummaries ? () => getProductSummaries.call(platform?.app) : null
  }
}

/**
 * 平台/产品资源任务的唯一数据源：`jobRuntime.listSchedules()` 的只读投影。
 * 注册状态直接取投影里的 `registered`，本 hook 不读取任何 enable 开关、也不构造本地影子列表。
 *
 * 健壮性契约：任何分支（桥缺失、同步抛、读取失败、超时、正常返回）都必须 `setLoading(false)`，
 * 且不得向调用方抛出未处理的 rejection。
 */
export function useResourceJobSchedules(options: { language: AppLanguage; timeoutMs?: number }): ResourceJobSchedulesController {
  const { language } = options
  const timeoutMs = options.timeoutMs ?? RESOURCE_JOB_SCHEDULES_TIMEOUT_MS
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [errorReason, setErrorReason] = useState<ResourceJobSchedulesErrorReason | null>(null)
  const [items, setItems] = useState<JobScheduleView[]>([])
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const requestId = useRef(0)
  const timeoutHandles = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  async function reload(): Promise<void> {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(false)
    setErrorReason(null)
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    try {
      const bridge = readResourceJobBridge()
      if (!bridge) {
        if (requestId.current !== currentRequest) return
        setItems([])
        setProductNames({})
        setError(true)
        setErrorReason('bridge-missing')
        return
      }

      // 先包进 Promise.resolve().then(...) 再交给 allSettled：
      // 桥方法同步抛错时会变成 rejected promise，而不是在 await 之前逸出 reload()。
      const read = Promise.allSettled([
        Promise.resolve().then(() => bridge.listSchedules()),
        Promise.resolve().then(() => (bridge.getProductSummaries ? bridge.getProductSummaries() : []))
      ])
      const timedOut = new Promise<'timeout'>((resolve) => {
        const handle = setTimeout(() => resolve('timeout'), timeoutMs)
        timeoutHandle = handle
        timeoutHandles.current.add(handle)
      })
      const settled = await Promise.race([
        read.then((results) => ({ kind: 'settled' as const, results })),
        timedOut.then(() => ({ kind: 'timeout' as const }))
      ])
      if (requestId.current !== currentRequest) return
      if (settled.kind === 'timeout') {
        setItems([])
        setProductNames({})
        setError(true)
        setErrorReason('timeout')
        return
      }

      const [schedules, summaries] = settled.results
      if (schedules.status === 'fulfilled') setItems(schedules.value)
      else {
        setItems([])
        setError(true)
        setErrorReason('read-failed')
      }
      setProductNames(summaries.status === 'fulfilled'
        ? Object.fromEntries(summaries.value.map((summary) => [summary.id, summary.name[language]]))
        : {})
    } catch {
      if (requestId.current === currentRequest) {
        setItems([])
        setProductNames({})
        setError(true)
        setErrorReason('read-failed')
      }
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle)
        timeoutHandles.current.delete(timeoutHandle)
      }
      if (requestId.current === currentRequest) setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [language])

  useEffect(() => () => {
    // 卸载后不再有页面消费结果：取消在途请求并清掉所有定时器。
    requestId.current += 1
    for (const handle of timeoutHandles.current) clearTimeout(handle)
    timeoutHandles.current.clear()
  }, [])

  return { loading, error, errorReason, items, productNames, reload }
}
