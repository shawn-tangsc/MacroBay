import { useEffect, useState } from 'react'

import { readAnalysisConclusionSendChannel, type SendChannelReadiness } from '../../shared/ipc/analysisConclusionSendClient'

/**
 * 「现在能不能发」——**点击前**那一问，只认平台那一份派生（`resolvePushChannel`）。
 *
 * 三条：
 * 1. **0 条 → 按钮整个不渲染**（不是禁用）：一个点下去必然以配置原因失败的入口，就是「没接线的入口」；
 * 2. **≥1 条就照常摆**（多通道是合法配置：一条消息发到所有已启用通道），点击不会因为「配了多条」被拒；
 * 3. **读不出来也不渲染**：宁可先不摆，也不摆一个说不清结果的按钮。
 *
 * 抽屉每打开一次读一次：读者是在设置页改完通道再回来的，沿用上次的结论就会给出旧答案。
 */
export type SendReadiness = Readonly<{ state: 'unknown' }> | SendChannelReadiness

export function useAnalysisConclusionSendReadiness(input: Readonly<{
  open: boolean
  /** 台面注入：默认走产品 IPC，用例里换成桩。 */
  read?: (() => Promise<SendChannelReadiness>) | undefined
}>): SendReadiness {
  const [readiness, setReadiness] = useState<SendReadiness>({ state: 'unknown' })
  const read = input.read ?? readAnalysisConclusionSendChannel
  useEffect(() => {
    if (!input.open) return undefined
    let cancelled = false
    setReadiness({ state: 'unknown' })
    read().then(
      (value) => { if (!cancelled) setReadiness(value) },
      // 读不到就是「这次读不到」：不摆按钮，也不把它说成「你没有通道」。
      () => { if (!cancelled) setReadiness({ state: 'unavailable' }) }
    )
    return () => { cancelled = true }
  }, [input.open, read])
  return readiness
}

/** 按钮摆不摆：只有「有一条可用的通道」才摆。还在读、读不到、一条都没有都不摆。 */
export function sendActionOffered(readiness: SendReadiness): boolean {
  return readiness.state === 'ready'
}
