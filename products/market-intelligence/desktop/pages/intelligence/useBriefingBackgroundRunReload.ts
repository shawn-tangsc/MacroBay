import { useEffect, useRef } from 'react'

/**
 * 别人发起的跑一开始，就让列表重读一次。
 *
 * 本页发起的跑会先挂一行"生成中"占位行，所以它一定立刻有行；定时触发、或别的窗口发起的那一跑
 * 没有这一行——而列表只在跑完、删除、重试时重读，于是它要等跑完才出现在列表里。用户 2026-11-06
 * 的规则是"只要开始跑了，就要留在 list 里"，所以进度一开始说"在跑"，就重读一次。
 *
 * 只在**从不在跑变成在跑**的那一下重读：一直重读会把列表刷得读者没法点行。
 */
export function useBriefingBackgroundRunReload(running: boolean, reload: () => void): void {
  const seenRef = useRef(false)
  useEffect(() => {
    if (!running) {
      seenRef.current = false
      return
    }
    if (seenRef.current) return
    seenRef.current = true
    reload()
  }, [running, reload])
}
