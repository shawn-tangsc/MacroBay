import { useCallback, useEffect, useState } from 'react'

import { newsInterpretationClient, type NewsInterpretationReadView } from '../../../shared/ipc/newsInterpretationClient'

/**
 * 按条读「AI 解读」的只读状态（R37）：菜单该显示「查看」还是「再次解读」、右栏那一节该不该出现。
 *
 * 读不到就是 `unreadable`，**不冒充 `none`**（后者是「确实没有已有解读」）。
 * 每次换条、或手动 `reload()` 时重读；不缓存跨条结果，避免把别的条目的解读画到这一条上。
 */
export function useNewsInterpretationRead(
  itemId: string | undefined,
  enabled: boolean
): Readonly<{ view?: NewsInterpretationReadView; loading: boolean; reload: () => void }> {
  const [view, setView] = useState<NewsInterpretationReadView>()
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState(0)

  useEffect(() => {
    if (!enabled || itemId === undefined) {
      setView(undefined)
      return
    }
    let active = true
    setLoading(true)
    void newsInterpretationClient.read(itemId).then((next) => {
      if (!active) return
      setView(next)
      setLoading(false)
    })
    return () => { active = false }
  }, [enabled, itemId, token])

  const reload = useCallback(() => { setToken((value) => value + 1) }, [])
  return { ...(view === undefined ? {} : { view }), loading, reload }
}
