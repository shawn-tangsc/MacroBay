import { useEffect, useRef, useState } from 'react'

import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type { DashboardFeedStatusView } from '../../../contracts/macro/dashboardFeedStatusContracts'
import type { createCrossAssetObservationClient } from '../../shared/ipc/crossAssetObservationClient'
import type { DashboardFeedStatusClient } from '../../shared/ipc/dashboardFeedStatusClient'

/**
 * The strip's two slow reads: the reader's switches and last outcomes per source, and the cross-asset
 * snapshot that says which index leg is answering.
 *
 * A minute, not the panel's second: a switch, a credential and a failure code change when the reader
 * acts or a collection fails, and neither needs a per-second poll. The cross-asset read here is
 * read-only and takes no lease — the panel still owns the lease and the one-second cadence.
 */
export const dashboardFeedStatusViewPolicy = Object.freeze({ refreshMs: 60_000, indexRange: '24h' as const })

/**
 * `feedState` 是**源级启用表**自己的结算状态：`ready` 才是可判的，`failed` 是「读不到」——
 * 调用方据此决定「暂时读不到」，不许把它当成「全都启用」。`reload` 给三态里的「再试一次」用。
 */
export function useDashboardFeedStatus({ client, crossAssetClient, now = Date.now }: {
  client?: DashboardFeedStatusClient
  crossAssetClient?: ReturnType<typeof createCrossAssetObservationClient>
  /** 注入时钟：偏旧的界限必须可测（不 sleep、不读真实时间）。 */
  now?: () => number
}): Readonly<{
  feed?: DashboardFeedStatusView
  feedState: 'loading' | 'ready' | 'failed'
  /** 表读失败、但手里有上一次成功的表（`feed` 仍在）：用它继续判，同时标「上次读数」。 */
  feedStale: boolean
  /** 上一次成功读到表的时间（毫秒）；只在沿用时给，用来把「偏旧」的时刻写出来。 */
  feedLastSuccessAtMs?: number
  index?: CrossAssetSnapshot
  indexState: 'loading' | 'ready' | 'unavailable'
  reload: () => void
}> {
  const [feed, setFeed] = useState<DashboardFeedStatusView>()
  const [feedState, setFeedState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const lastGood = useRef<DashboardFeedStatusView>(undefined)
  const lastGoodAt = useRef<number | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [index, setIndex] = useState<CrossAssetSnapshot>()
  const [indexState, setIndexState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  useEffect(() => {
    // 没有读口 = 这一份表**读不到**，不是「还在读」。停在 loading 会让上层 `decisionsUsable`
    // 恒为 false，整页一处都不读也不报错——静默停读（今晚 5 条用例被这个形状吃掉过一次）。
    if (!client && !crossAssetClient) {
      setFeedState('failed')
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      const [nextFeed, nextIndex] = await Promise.all([
        client ? client.query() : Promise.resolve(undefined),
        crossAssetClient ? crossAssetClient.query({ range: dashboardFeedStatusViewPolicy.indexRange }) : Promise.resolve(undefined)
      ])
      if (!active) return
      if (nextFeed) {
        setFeed(nextFeed)
        if (nextFeed.state === 'available') {
          lastGood.current = nextFeed
          lastGoodAt.current = now()
        }
        setFeedState(nextFeed.state === 'available' ? 'ready' : 'failed')
      } else if (client) {
        setFeedState('failed')
      }
      if (!crossAssetClient) setIndexState('unavailable')
      else if (nextIndex && 'schemaVersion' in nextIndex) { setIndex(nextIndex); setIndexState('ready') }
      else setIndexState('unavailable')
      timer = setTimeout(() => { void read() }, dashboardFeedStatusViewPolicy.refreshMs)
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [client, crossAssetClient, attempt])
  // 沿用上一次成功的表有界限：连续 5 次刷新都没成功（refreshMs × 5）就停止沿用，改整表报错。
  const withinStaleWindow = lastGoodAt.current !== undefined && now() - lastGoodAt.current <= dashboardFeedStatusViewPolicy.refreshMs * 5
  const useLastGood = feedState !== 'ready' && lastGood.current !== undefined && withinStaleWindow
  return {
    feed: feedState === 'ready' ? feed : useLastGood ? lastGood.current : undefined,
    feedState,
    feedStale: feedState === 'failed' && useLastGood,
    feedLastSuccessAtMs: useLastGood ? lastGoodAt.current : undefined,
    ...(index ? { index } : {}),
    indexState,
    reload: () => setAttempt(value => value + 1)
  }
}
