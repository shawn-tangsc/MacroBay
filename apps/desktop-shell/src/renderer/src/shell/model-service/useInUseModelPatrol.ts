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
      // 全局读口：不依赖用户先在模型服务页选中某个供应商——模型下线时他往往没开着那一页。
      // 读不到就当作「读不到」：不清空已有结论，也不假装「没有下线模型」。
      try {
        const items = await window.platform.modelProviders.getInUseRetired()
        if (!cancelled) setRetired(items as InUseModelRetiredItem[])
      } catch {
        // 保持上一次已知结果，不把读取失败改写成「没有」。
      }
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
