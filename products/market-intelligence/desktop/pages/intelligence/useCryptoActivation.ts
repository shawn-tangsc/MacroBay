import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { subscribeSettingsRevision } from '../../shared/events/settingsRevision'
import { countAgentGroups, type AgentView } from '../../../service/intelligence/application/sourceProjection'
import { projectActivation, type ActivationState } from './agentActivationPolicy'

export type CryptoActivation = Readonly<{
  activation: ActivationState
  sourceCounts: Record<string, number>
  /** Re-reads the agent view. The card's 「再试一次」 calls this and it really asks again. */
  retry: () => void
}>

type ReadState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; view: AgentView }>
  | Readonly<{ status: 'unavailable' }>

/**
 * crypto 卡片只读投影：可见来源总数 / 健康来源数。
 * 来源配置由既有情报源抽屉负责；这里不写任何配置。
 *
 * A read that fails is carried as its own state, not folded into an empty view: the card has to be
 * able to say 「暂时读不到」 without pretending the reader configured nothing.
 */
export function useCryptoActivation(): CryptoActivation {
  const [read, setRead] = useState<ReadState>({ status: 'loading' })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const load = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    // A retry shows the loading state; the sources-changed refresh keeps the last reading on screen
    // until the new one lands, so a background toggle does not blank the card.
    if (!options?.silent) setRead({ status: 'loading' })
    try {
      const view = await intelligenceSourcesClient.getAgentView('crypto')
      if (!alive.current) return
      // No view for a known agent is a failed read, not an empty setup: the difference is the
      // whole point of this state.
      setRead(view ? { status: 'ready', view } : { status: 'unavailable' })
    } catch {
      if (alive.current) setRead({ status: 'unavailable' })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 来源改了 → 重读自己的投影（`getAgentView`）。订阅的是设置域信号（`sources`），
  // 不是旧的 `market-intelligence:sources-changed`：那条已被域信号取代，配置线随后会删掉它。
  // 这里不写配置，也就没有「自己发出、自己忽略」的那一侧，`origin` 用不上。
  useEffect(() => subscribeSettingsRevision('sources', () => { void load({ silent: true }) }), [load])

  const activation = useMemo<ActivationState>(() => {
    if (read.status === 'loading') return { status: 'loading' }
    if (read.status === 'unavailable') return { status: 'unavailable' }
    return { status: 'ready', ...projectActivation(read.view) }
  }, [read])

  return {
    activation,
    retry: () => { void load() },
    sourceCounts: {
      crypto: countAgentGroups('crypto'),
      stocks: countAgentGroups('stocks'),
      futures: countAgentGroups('futures')
    }
  }
}
