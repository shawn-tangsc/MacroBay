import { useEffect, useState } from 'react'

import type { QuarantineCopyScan } from '@platform/storage/quarantine/quarantineCopies'
import {
  beginRefresh,
  failRefresh,
  initialAsyncState,
  settle,
  type AsyncState
} from '@platform/ui/async/asyncState'

/**
 * 隔离副本清单的一次读取。
 *
 * 与缓存表分开成一条读取：两者的失败互不牵连——缓存巡检挂了不该把「有没有隔离副本」也说成
 * 读不到，反过来也一样。生命周期仍用平台那一个 `AsyncState`，页面不自己拼三态。
 */
export type QuarantineCopiesState = Readonly<{
  state: AsyncState<QuarantineCopyScan>
  reload: () => Promise<void>
}>

async function readScan(): Promise<QuarantineCopyScan> {
  const scan = (await window.platform.storage.listQuarantineCopies()) as QuarantineCopyScan
  // 形状不信任：读回来的东西缺字段时按「读不到」处理，别把 `undefined` 当零份副本画出去。
  if (!Array.isArray(scan?.copies) || typeof scan.unreadableDirectories !== 'number' || typeof scan.truncated !== 'boolean') {
    throw new Error('quarantine-scan-invalid')
  }
  return scan
}

export function useQuarantineCopies(): QuarantineCopiesState {
  const [state, setState] = useState<AsyncState<QuarantineCopyScan>>(initialAsyncState)

  async function reload(): Promise<void> {
    setState((prev) => beginRefresh(prev))
    try {
      const scan = await readScan()
      setState((prev) => settle(prev, scan))
    } catch {
      // 扫描根目录读不出来 = 读不到（错误态 + 重试），不是「一份副本都没有」。
      setState((prev) => failRefresh(prev, 'unreadable'))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  return { state, reload }
}
