import { useCallback, useEffect, useState } from 'react'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'
import { countAgentGroups, type AgentView } from '../../../service/intelligence/application/sourceProjection'

/**
 * Keeps the page free of IPC and service imports: index.tsx only consumes this
 * hook, while the hook owns the agent projection and the required-source
 * enablement.
 */
export function useAgentActivation(): {
  agentView?: AgentView
  sourceCounts: Record<string, number>
  enableRequired: () => Promise<void>
} {
  const [agentView, setAgentView] = useState<AgentView>()

  const load = useCallback(async () => {
    setAgentView(await intelligenceSourcesClient.getAgentView('crypto').catch(() => undefined))
  }, [])

  useEffect(() => { void load() }, [load])

  const enableRequired = useCallback(async () => {
    const required = agentView?.groups.filter((group) => group.tier === 'required') ?? []
    for (const group of required) {
      for (const source of group.sources) {
        if (!source.enabled && source.visibility !== 'pending') {
          await intelligenceSourcesClient.setEnabled(source.sourceId, true)
        }
      }
    }
    await load()
  }, [agentView, load])

  return {
    agentView,
    sourceCounts: {
      crypto: countAgentGroups('crypto'),
      stocks: countAgentGroups('stocks'),
      futures: countAgentGroups('futures')
    },
    enableRequired
  }
}
