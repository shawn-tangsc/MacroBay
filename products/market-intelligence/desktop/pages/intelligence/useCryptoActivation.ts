import { useCallback, useEffect, useMemo, useState } from 'react'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { INTELLIGENCE_SOURCES_CHANGED_EVENT } from '../../shared/events/intelligenceSourcesChanged'
import { countAgentGroups, type AgentView } from '../../../service/intelligence/application/sourceProjection'
import { projectActivation, type ActivationProjection } from './agentActivationPolicy'

export type CryptoActivation = Readonly<{
  activation: ActivationProjection
  sourceCounts: Record<string, number>
}>

/**
 * crypto 卡片只读投影：可见来源总数 / 健康来源数。
 * 来源配置由既有情报源抽屉负责；这里不写任何配置。
 */
export function useCryptoActivation(): CryptoActivation {
  const [agentView, setAgentView] = useState<AgentView>()

  const load = useCallback(async () => {
    setAgentView(await intelligenceSourcesClient.getAgentView('crypto').catch(() => undefined))
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onSourcesChanged = (): void => { void load() }
    window.addEventListener(INTELLIGENCE_SOURCES_CHANGED_EVENT, onSourcesChanged)
    return () => window.removeEventListener(INTELLIGENCE_SOURCES_CHANGED_EVENT, onSourcesChanged)
  }, [load])

  const activation = useMemo(() => projectActivation(agentView), [agentView])

  return {
    activation,
    sourceCounts: {
      crypto: countAgentGroups('crypto'),
      stocks: countAgentGroups('stocks'),
      futures: countAgentGroups('futures')
    }
  }
}
