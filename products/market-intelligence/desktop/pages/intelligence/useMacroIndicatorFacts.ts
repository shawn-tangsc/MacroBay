import { useCallback, useEffect, useState } from 'react'

import { macroIndicatorClient, type MacroIndicatorReadResult } from '../../shared/ipc/macroIndicatorClient'

/**
 * 三张卡的读数：装配层一次读回四个指标的事实，抽屉只渲染它。
 *
 * 十分钟一读与政策路径同频：这两块读的是同一个采集周期写下的行，读得更勤只会重复读同一行。
 * 读失败保留上一次成功的结果（不把有数的卡擦成空白）；一次都没读成功时由宿主把
 * `cardFactsUnreadable` 传给抽屉，卡上写「暂时读不到」，不写「未提供」。
 */
export function useMacroIndicatorFacts(enabled: boolean, revision?: number): Readonly<{
  result?: MacroIndicatorReadResult
  reload: () => void
}> {
  const [result, setResult] = useState<MacroIndicatorReadResult | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const read = async () => {
      const next = await macroIndicatorClient.read(new Date().toISOString()).catch(() => undefined)
      if (!cancelled && next !== undefined) setResult(next)
    }
    void read()
    const timer = setInterval(() => { void read() }, 10 * 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled, tick, revision])
  return { ...(result === undefined ? {} : { result }), reload }
}
