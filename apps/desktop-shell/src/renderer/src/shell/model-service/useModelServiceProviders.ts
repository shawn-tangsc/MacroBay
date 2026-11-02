import { useCallback, useEffect, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { beginRefresh, failRefresh, initialAsyncState, settle, type AsyncState } from '@platform/ui/async/asyncState'

import { firstProviderIdForRail } from './ModelServiceProviderRail'

/**
 * 模型服务的启动读数：供应商列表，模型与端点随它一次到达。
 *
 * 为什么不是三个 `useState`（列表 / 读完了没有 / 读失败了）：那三个值可以互相矛盾，
 * 于是「还在读」被画成「没有供应商」或「读取失败」。这里只有一次生命周期转移
 * （台账 §25 / `MI-11-R161`）：
 *  - 首次只可能是 `loading`，读失败才落 `error`；
 *  - 刷新失败保留上一次的列表并标 `stale`，不把已经看到的行删掉；
 *  - `providers` 只在 `ready` 上有值，调用点不必再判一次。
 */
export type ModelServiceProviders = {
  state: AsyncState<SafeModelProvider[]>
  /** 只在 `ready` 上有值；`loading` 与 `error` 都是空数组。 */
  providers: SafeModelProvider[]
  selectedProviderId: string | null
  selectProvider: (providerId: string | null) => void
  reload: (preferredProviderId?: string) => Promise<void>
}

export function useModelServiceProviders(): ModelServiceProviders {
  const [state, setState] = useState<AsyncState<SafeModelProvider[]>>(initialAsyncState)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  /**
   * 重新读一次列表。**不抛**：读失败已经进了状态，调用点（保存、启用、删除之后的重读）
   * 不该把「写成功了但重读没成功」报成写失败——那些操作本身是成功的，界面保留旧列表并标 stale。
   */
  const reload = useCallback(async (preferredProviderId?: string): Promise<void> => {
    setState((current) => beginRefresh(current))
    let nextProviders: SafeModelProvider[]
    try {
      nextProviders = (await window.platform.modelProviders.list()) as SafeModelProvider[]
    } catch {
      setState((current) => failRefresh(current, 'unreadable'))
      return
    }
    setState((current) => settle(current, nextProviders))
    setSelectedProviderId((current) => {
      if (preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)) return preferredProviderId
      if (current && nextProviders.some((provider) => provider.id === current)) return current
      return firstProviderIdForRail(nextProviders)
    })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    state,
    providers: state.status === 'ready' ? state.data : [],
    selectedProviderId,
    selectProvider: setSelectedProviderId,
    reload
  }
}
