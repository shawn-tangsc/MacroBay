/**
 * 示例模式的渲染层会话。
 *
 * 状态不再由页面自己持有：它订阅 `sampleModeSessionStore`，与 crypto 卡片示例入口共享同一份快照。
 * 「现在」接到场景时钟，切换时给面板一个重挂载 key。
 * 没有 Provider 时（大量既有单测直接渲染面板）所有 hook 都退化成真实时钟，不会抛错。
 */

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import { emptySampleModeState, sampleModeClient, type SampleModeClient, type SampleModeState } from '../../shared/ipc/sampleModeClient'
import {
  createSampleModeSessionStore,
  sampleModeSessionStore
} from '../../shared/sampleMode/sampleModeSessionStore'

export type SampleModeContextValue = Readonly<{
  state: SampleModeState
  busy: boolean
  /** 示例激活时返回场景时钟，否则返回真实时间。不要用它生成观测时间。 */
  now: () => Date
  enter: () => Promise<boolean>
  exit: () => Promise<boolean>
  /** 示例激活时按当前语言重新解析场景。 */
  refresh: () => Promise<boolean>
  /** 切换时变化：面板以它作 key 即可在退出示例后重新读真实数据。 */
  sessionKey: string
}>

const fallback: SampleModeContextValue = {
  state: emptySampleModeState,
  busy: false,
  now: () => new Date(),
  enter: async () => false,
  exit: async () => false,
  refresh: async () => false,
  sessionKey: 'live'
}

const SampleModeContext = createContext<SampleModeContextValue>(fallback)

export function useSampleMode(): SampleModeContextValue {
  return useContext(SampleModeContext)
}

export function useSampleNow(): () => Date {
  return useContext(SampleModeContext).now
}

export function SampleModeProvider({ children, client = sampleModeClient }: {
  children: ReactNode
  client?: SampleModeClient
}): React.ReactElement {
  /**
   * 生产环境只有一份全局 store；测试注入 fake client 时退化成局部 store，
   * 避免测试之间共享状态。两种路径的 Provider API 完全一致。
   */
  const store = useMemo(
    () => (client === sampleModeClient ? sampleModeSessionStore : createSampleModeSessionStore(client)),
    [client]
  )
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const state = snapshot.view
  const busy = snapshot.busy

  const now = useCallback(() => (
    state.active && state.scenarioNow ? new Date(state.scenarioNow) : new Date()
  ), [state.active, state.scenarioNow])

  const enter = useCallback(async () => store.enter(), [store])
  const exit = useCallback(async () => store.exit(), [store])
  const refresh = useCallback(async () => store.refresh(), [store])

  const value = useMemo<SampleModeContextValue>(() => ({
    state,
    busy,
    now,
    enter,
    exit,
    refresh,
    // locale 也进 key：切语言后整块看板重挂载，卡片会用新语言重新查询（日历页的 locale 是查询条件）。
    sessionKey: state.active ? `${state.scenarioId ?? 'sample'}:${state.scenarioNow ?? ''}:${state.locale ?? ''}` : 'live'
  }), [state, busy, now, enter, exit, refresh])

  return <SampleModeContext.Provider value={value}>{children}</SampleModeContext.Provider>
}
