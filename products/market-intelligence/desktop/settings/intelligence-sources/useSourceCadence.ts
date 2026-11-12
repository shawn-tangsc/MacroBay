import { useCallback, useEffect, useState } from 'react'

import type { JobScheduleView } from '@platform/jobs'

import { subscribeSettingsRevision } from '../../shared/events/settingsRevision'
import { readSourceCadence, type SourceCadenceReadout } from './sourceCadence'

/** 桥缺失（旧 preload / 未重启）时按「这次读不到」处理，不把读数画成 0。 */
type JobsBridge = Readonly<{ listSchedules?: () => Promise<JobScheduleView[]> }>

export type SourceCadenceState = Readonly<{
  /** 这一批读到了没有。`false` = 桥缺失或调用失败，界面不画读数、ⓘ 里说明原因。 */
  available: boolean
  bySource: Readonly<Record<string, SourceCadenceReadout>>
}>

/**
 * 「当前间隔 / 下次采集」的唯一读口。
 *
 * 三条（用户 2026-11-13 定的取数纪律）：
 * 1. **一次全量读**，不按源轮询：`listSchedules()` 本来就是全量投影，44 个源也只发一次；
 * 2. 只在挂载时读一次，之后**随 `sources` 域信号重读**（改档、启停都会让它变）；
 * 3. 读的过程中再来信号只记一个排队，本轮结束后补一次——连点不会打出一串 IPC。
 */
export function useSourceCadence(): SourceCadenceState {
  const [state, setState] = useState<SourceCadenceState>({ available: true, bySource: {} })

  const read = useCallback((): Promise<void> => {
    const bridge = (window as unknown as { platform?: { jobs?: JobsBridge } }).platform?.jobs
    if (bridge === undefined || typeof bridge.listSchedules !== 'function') {
      setState({ available: false, bySource: {} })
      return Promise.resolve()
    }
    return bridge.listSchedules()
      .then((schedules) => { setState({ available: true, bySource: readSourceCadence(schedules) }) })
      // 读失败 ≠ 没有排期：整批按「读不到」表示，别把 44 个源画成「未安排」。
      .catch(() => { setState({ available: false, bySource: {} }) })
  }, [])

  useEffect(() => {
    let active = true
    let inFlight = false
    let queued = false
    const request = (): void => {
      if (inFlight) { queued = true; return }
      inFlight = true
      void read().finally(() => {
        inFlight = false
        if (queued) { queued = false; request() }
      })
    }
    request()
    const unsubscribe = subscribeSettingsRevision('sources', () => { if (active) request() })
    return () => { active = false; unsubscribe() }
  }, [read])

  return state
}
