import { useCallback, useEffect, useState } from 'react'

import type { IntelligenceFearGreedClient } from '../../features/industry/fear-greed'
import { isCanonicalFearGreedSnapshotTime } from '../../../contracts/intelligenceQueryContracts'
import { projectDashboardFearGreedSnapshot, type DashboardFearGreedState } from './dashboardFearGreedModel'

type Input = {
  client: Pick<IntelligenceFearGreedClient, 'querySnapshot'>
  now: () => Date
  /**
   * 读者把这一格关掉了：一次请求都不发，状态停在等待态——卡片由上层整张跳过，这里不给结论。
   * 与「没接上客户端」（读不到）是两件事，不能共用一个 undefined。
   */
  disabled?: boolean
}

export function useDashboardFearGreed({ client, now, disabled = false }: Input): Readonly<{ state: DashboardFearGreedState; reload: () => void }> {
  const [state, setState] = useState<DashboardFearGreedState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [mountInput] = useState(() => ({ client, now }))
  /** 重试入口：读者按「再试一次」时重新问一次快照，而不是刷新整页。 */
  const reload = useCallback(() => setAttempt(current => current + 1), [])

  useEffect(() => {
    let active = true
    // 每次重试先回到加载态，读者才看得出这一下真的重新问了。
    setState({ state: 'loading' })
    if (disabled) return () => { active = false }
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf) {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    void mountInput.client.querySnapshot({ asOf }).then((result) => {
      if (active) setState(projectDashboardFearGreedSnapshot(result, asOf))
    }).catch(() => {
      if (active) setState({ state: 'unavailable' })
    })
    return () => { active = false }
  }, [mountInput, attempt, disabled])

  return { state, reload }
}

function readCanonicalClock(now: () => unknown): string | undefined {
  try {
    const instant = now()
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return undefined
    const asOf = instant.toISOString()
    return isCanonicalFearGreedSnapshotTime(asOf) ? asOf : undefined
  } catch {
    return undefined
  }
}
