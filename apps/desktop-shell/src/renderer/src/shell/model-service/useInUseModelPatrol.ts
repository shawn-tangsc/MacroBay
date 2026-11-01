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
export function useInUseModelPatrol(input: { enabled?: boolean } = {}): InUseModelRetiredItem[] {
  const [retired, setRetired] = useState<InUseModelRetiredItem[]>([])
  const enabled = input.enabled !== false

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const load = async (): Promise<void> => {
      // 老版本 preload 或测试里的部分替身没有这个方法：没有结论时按「没有下线模型」处理，
      // 但不要去猜一个结论出来。
      const api = window.platform.modelProviders as {
        getInUseRetired?: () => Promise<InUseModelRetiredItem[]>
      }
      const items = await (api.getInUseRetired?.() ?? Promise.resolve([])).catch(
        () => [] as InUseModelRetiredItem[]
      )
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
  }, [enabled])

  return retired
}
