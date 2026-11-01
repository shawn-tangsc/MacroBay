import { useEffect, useState } from 'react'

import type { InUseModelRetiredItem } from '@platform/ai/providers/inUseModelPatrol'

/**
 * 「在用模型已下线」提示的数据来源。
 *
 * 巡检本身已挪到主进程（`platform/ai/providers/inUseModelPatrolRuntime`）：界面层不承担外部请求，
 * 也不承担调度——窗口关掉巡检就停、开两个窗口就发两遍，这两种毛病都来自在渲染层起定时器。
 *
 * 这里只做一次读取，并在窗口重新可见时同步一次；没有 `setInterval`。
 */
export function useInUseModelPatrol(
  input: { providerId?: string | null; modelId?: string | null; enabled?: boolean } = {}
): InUseModelRetiredItem[] {
  const [retired, setRetired] = useState<InUseModelRetiredItem[]>([])
  const enabled = input.enabled !== false && Boolean(input.providerId)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async (): Promise<void> => {
      // 读的是既有的「模型可用性检查报告」：巡检结论是它的一部分，不为它单开通道。
      // 测试与旧 preload 可能没有这个方法：没有报告就没有结论，不猜一个出来。
      const api = window.platform.modelProviders as {
        getRuntimeCheckReport?: (providerId: string, modelId: string) => Promise<unknown>
      }
      const report = await (api.getRuntimeCheckReport?.(input.providerId as string, input.modelId ?? '') ??
        Promise.resolve(null)).catch(() => null)
      const items = (report as { inUseRetired?: InUseModelRetiredItem[] } | null)?.inUseRetired ?? []
      if (!cancelled) setRetired(items)
    }

    void load()
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, input.providerId, input.modelId])

  return retired
}
