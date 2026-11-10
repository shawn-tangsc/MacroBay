import { useEffect, useState } from 'react'

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
export function useDashboardFeedStatus({ client, crossAssetClient }: {
  client?: DashboardFeedStatusClient
  crossAssetClient?: ReturnType<typeof createCrossAssetObservationClient>
}): Readonly<{
  feed?: DashboardFeedStatusView
  feedState: 'loading' | 'ready' | 'failed'
  index?: CrossAssetSnapshot
  indexState: 'loading' | 'ready' | 'unavailable'
  reload: () => void
}> {
  const [feed, setFeed] = useState<DashboardFeedStatusView>()
  const [feedState, setFeedState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [index, setIndex] = useState<CrossAssetSnapshot>()
  const [indexState, setIndexState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  useEffect(() => {
    if (!client && !crossAssetClient) return
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
  return { feed, feedState, ...(index ? { index } : {}), indexState, reload: () => setAttempt(value => value + 1) }
}
