/**
 * 示例模式的渲染层会话。
 *
 * 只做三件事：保存主进程的会话状态、把「现在」接到场景时钟、给面板一个切换时重挂载的 key。
 * 没有 Provider 时（大量既有单测直接渲染面板）所有 hook 都退化成真实时钟，不会抛错。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { emptySampleModeState, sampleModeClient, type SampleModeClient, type SampleModeState } from '../../shared/ipc/sampleModeClient'

export type SampleModeContextValue = Readonly<{
  state: SampleModeState
  busy: boolean
  /** 示例激活时返回场景时钟，否则返回真实时间。不要用它生成观测时间。 */
  now: () => Date
  enter: () => Promise<void>
  exit: () => Promise<void>
  /** 切换时变化：面板以它作 key 即可在退出示例后重新读真实数据。 */
  sessionKey: string
}>

const fallback: SampleModeContextValue = {
  state: emptySampleModeState,
  busy: false,
  now: () => new Date(),
  enter: async () => undefined,
  exit: async () => undefined,
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
  const [state, setState] = useState<SampleModeState>(emptySampleModeState)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    void client.getState().then((next) => { if (mounted) setState(next) })
    return () => { mounted = false }
  }, [client])

  const now = useCallback(() => (
    state.active && state.scenarioNow ? new Date(state.scenarioNow) : new Date()
  ), [state.active, state.scenarioNow])

  const enter = useCallback(async () => {
    setBusy(true)
    try {
      setState(await client.setActive(true))
    } finally {
      setBusy(false)
    }
  }, [client])

  const exit = useCallback(async () => {
    setBusy(true)
    try {
      setState(await client.setActive(false))
    } finally {
      setBusy(false)
    }
  }, [client])

  const value = useMemo<SampleModeContextValue>(() => ({
    state,
    busy,
    now,
    enter,
    exit,
    sessionKey: state.active ? `${state.scenarioId ?? 'sample'}:${state.scenarioNow ?? ''}` : 'live'
  }), [state, busy, now, enter, exit])

  return <SampleModeContext.Provider value={value}>{children}</SampleModeContext.Provider>
}
