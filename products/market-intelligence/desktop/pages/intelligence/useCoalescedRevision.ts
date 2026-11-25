import { useEffect, useRef, useState } from 'react'

export type CoalescedRevisionOptions = {
  /** 安静多久之后才自增（连续事件会把这次往后推）。 */
  trailingMs?: number
  /** 从第一件等起，最多等这么久就必须自增一次；不随事件条数线性增长。 */
  maxWaitMs?: number
  /** 页面隐藏时只记 pending，回到前台立刻补一次。 */
  pauseWhileHidden?: boolean
}

/**
 * 页面级数据 revision 的一个**合并层**：只有这张卡消费它，共用源一行不动。
 *
 * 为什么不在 `useDataChangeRevision` 里加参数：那条 revision 还喂着政策路径、资金面、持仓、
 * 背离、费率与 OI，改它会顺手改掉别人的重读节奏；这里纯派生，其它卡照旧。
 *
 * 单飞不在这里：本层只决定「什么时候该读一次」，同一时间只允许一路在飞由读口自己管。
 */
export function useCoalescedRevision(sourceRevision: number, options: CoalescedRevisionOptions = {}): number {
  const { trailingMs = 5000, maxWaitMs = 30_000, pauseWhileHidden = true } = options
  const [revision, setRevision] = useState(sourceRevision)
  const seen = useRef(sourceRevision)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 第一件还没被消费的事件的到达时刻；null = 没有待发。 */
  const pendingSince = useRef<number | null>(null)

  const clearTimer = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const flush = (): void => {
    clearTimer()
    pendingSince.current = null
    setRevision(current => current + 1)
  }

  const schedule = (): void => {
    const now = Date.now()
    if (pendingSince.current === null) pendingSince.current = now
    const waited = now - pendingSince.current
    const delay = Math.max(0, Math.min(trailingMs, maxWaitMs - waited))
    clearTimer()
    timer.current = setTimeout(flush, delay)
  }

  useEffect(() => {
    if (sourceRevision === seen.current) return
    seen.current = sourceRevision
    if (pauseWhileHidden && isHidden()) {
      // 隐藏期间只记 pending：不排定时器，回前台由下面那条 effect 补发。
      pendingSince.current ??= Date.now()
      clearTimer()
      return
    }
    schedule()
  }, [sourceRevision])

  useEffect(() => {
    if (!pauseWhileHidden) return
    const onVisibilityChange = (): void => {
      if (isHidden() || pendingSince.current === null) return
      flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimer()
    }
  }, [pauseWhileHidden])

  return revision
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}
