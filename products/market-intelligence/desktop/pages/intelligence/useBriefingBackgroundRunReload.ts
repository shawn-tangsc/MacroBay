import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 别人发起的跑一开始，就让列表重读一次；**跑完那一拍也重读一次**。
 *
 * 两个时刻都要：
 * - 开始时——定时触发、或别的窗口发起的那一跑，列表里还没有那一行（用户 2026-11-06：只要开始跑了，
 *   就要留在 list 里）；
 * - 结束时——列表只在"跑完"之后才知道那一期真正的身份（时刻 / 来源 / 窗口）。少了这一次，行会
 *   一直停在前一次重读时的样子：9 步全跑完、右栏已经写完，左边还是「未记录」（用户 2026-11-07 报的）。
 *
 * **本页自己发起的跑不重读第二遍**：那条路跑完会把新文档合并进列表那一行（`mergeEditionSummary`），
 * 页面把 settle 次数传进来，同一次跑里有了它就不再重读。用"这次跑已经重读过"的标记判断，
 * 不用固定延时凑。
 */
export function useBriefingBackgroundRunReload(running: boolean, reload: () => void): Readonly<{ markLocalSettled: () => void }> {
  const [localSettles, setLocalSettles] = useState(0)
  const wasRunning = useRef(false)
  const settlesAtStart = useRef(0)
  // `reload` 每次渲染都是新函数：放进依赖会让 effect 每渲染一次跑一遍。用 ref 读最新那个。
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    if (running) {
      if (wasRunning.current) return
      wasRunning.current = true
      settlesAtStart.current = localSettles
      reloadRef.current()
      return
    }
    if (!wasRunning.current) return
    wasRunning.current = false
    // 本页自己发起的那一次：列表那一行已经由页面合并过，不再整表重读。
    if (localSettles !== settlesAtStart.current) return
    reloadRef.current()
  }, [running, localSettles])
  // 本页自己发起的那次跑落定时调一次：收尾由页面合并列表行，这里只记"这一次已处理过"。
  const markLocalSettled = useCallback(() => setLocalSettles((count) => count + 1), [])
  return { markLocalSettled }
}
