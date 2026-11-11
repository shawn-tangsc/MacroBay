import { useEffect, useRef } from 'react'

/**
 * 兜底轮询：**只在页面可见时跑**，切到后台就停表。
 *
 * 它是兜底不是主路径——采集写库会发 `intelligence.dataChanged`，信号正常时这条定时器永远只是
 * 空转。留着它只为「信号全丢了」时别让读数停在几分钟前：上限 5 分钟（各处自己传，见下）。
 * 用 `visibilitychange` 而不是在回调里 `if (hidden) return`：不可见时连表都不该走。
 */
export function useVisibleInterval(intervalMs: number, onTick: () => void): void {
  const latest = useRef(onTick)
  useEffect(() => { latest.current = onTick })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = (): void => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }
    const start = (): void => {
      if (timer !== undefined) return
      timer = setInterval(() => { latest.current() }, intervalMs)
    }
    const sync = (): void => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [intervalMs])
}
