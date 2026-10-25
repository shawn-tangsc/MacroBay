import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppLanguage, AppSettingsPatch, AgentSettings, ChatSettings } from '@platform/settings/schema/appSettings'
import {
  createAgentStoreState,
  type AgentStoreState
} from '@platform/ai/agent-platform/store/agentStore'
import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import { mergeAgentStoreSeeds, normalizeAgentStoreState } from '@platform/ai/agent-platform/store/agentPersistentStore'
import { createPlatformAgentSeed } from '@platform/ai/agent-platform/seeds'

import AgentNavbar from './AgentNavbar'
import AgentSidePanel from './AgentSidePanel'
import AgentChat from './AgentChat'
import AgentConfigPage from './editor/AgentConfigPage'
import type { AgentEditorMode } from './agentUiTypes'
import AgentSearchModal from './components/AgentSearchModal'
import AgentSidePanelDrawer from './components/AgentSidePanelDrawer'
import AgentModelGatewayStatusCard from './components/status/AgentModelGatewayStatusCard'
import { selectSession } from './agentStateActions'
import { AgentTextProvider } from './agentTextProvider'
import {
  getAgentChannelRuntimeSnapshotViaApi,
  getAgentRuntimeSnapshotViaApi,
  selectAgentViaApi,
  selectSessionViaApi
} from './agentSessionDataApi'
import {
  useAgentModelCompatibilityMap,
  useAgentModelGatewaySnapshot
} from './useAgentModelCompatibilityMap'
import { getAgentPageMinimumSize } from '@platform/ui/window/windowSizing'

type AgentPageProps = {
  language: AppLanguage
  agentSettings: AgentSettings
  chatSettings: ChatSettings
  providers: SafeModelProvider[]
  pinnedModelIds: string[]
  /** 模型服务页「默认智能体模型」：新建智能体时预填，运行时兜底。 */
  defaultAgentModelId?: string
  loadingModelService?: boolean
  onUpdateSettings: (patch: AppSettingsPatch) => Promise<void>
}

export function AgentPage({
  language,
  agentSettings,
  chatSettings,
  providers,
  pinnedModelIds,
  defaultAgentModelId,
  loadingModelService = false,
  onUpdateSettings
}: AgentPageProps): React.ReactElement {
  // 平台种子按当前界面语言生成：新库第一次落库就是正确语言，主进程再按 id 对齐旧行。
  const seed = useMemo(() => createPlatformAgentSeed(providers, { locale: language }), [providers, language])
  const [state, setState] = useState(() => createAgentStoreState(seed))
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<AgentSessionRuntimeSnapshot>({
    sessions: {},
    toolApprovals: [],
    toolApprovalHistory: [],
    chunksBySessionId: {},
    updatedAt: ''
  })
  const [channelRuntimeSnapshot, setChannelRuntimeSnapshot] = useState<AgentChannelRuntimeSnapshot>({
    channels: []
  })
  const [showSidebar, setShowSidebar] = useState(true)
  const [sidePanelDrawerOpen, setSidePanelDrawerOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<AgentEditorMode>({ type: 'closed' })
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const gateway = useAgentModelGatewaySnapshot()
  const loadedRef = useRef(false)

  const activeAgentModelKey = useMemo(() => {
    const model = state.agents.find((agent) => agent.id === state.activeAgentId)?.model ?? ''
    return model.includes(':') ? model : null
  }, [state.activeAgentId, state.agents])

  const compatibilityByModelKey = useAgentModelCompatibilityMap(
    providers,
    gateway.snapshot,
    activeAgentModelKey
  )

  const activeAgentModelRef = useMemo(() => {
    if (!activeAgentModelKey) return null
    const separatorIndex = activeAgentModelKey.indexOf(':')
    if (separatorIndex <= 0) return null
    return {
      providerId: activeAgentModelKey.slice(0, separatorIndex),
      modelId: activeAgentModelKey.slice(separatorIndex + 1)
    }
  }, [activeAgentModelKey])
  const persistState = useCallback((nextState: AgentStoreState) => {
    if (!loadedRef.current) return
    void window.platform.agents.replaceState(nextState)
  }, [])
  const updateState = useCallback(
    (updater: (state: AgentStoreState) => AgentStoreState) => {
      setState((current) => {
        const next = updater(current)
        persistState(next)
        return next
      })
    },
    [persistState]
  )

  useEffect(() => {
    let cancelled = false

    async function loadAgents(): Promise<void> {
      const [persisted, runtime, channelRuntime] = await Promise.all([
        window.platform.agents.getState(),
        getAgentRuntimeSnapshotViaApi(window.platform),
        getAgentChannelRuntimeSnapshotViaApi(window.platform)
      ])
      const merged = mergeAgentStoreSeeds(normalizeAgentStoreState(persisted), seed)
      if (cancelled) return
      setState(merged)
      setRuntimeSnapshot(runtime)
      setChannelRuntimeSnapshot(channelRuntime)
      loadedRef.current = true
      void window.platform.agents.replaceState(merged)
    }

    void loadAgents()

    return () => {
      cancelled = true
    }
  }, [seed])

  useEffect(() => {
    return window.platform.agents.onStateChanged((nextState) => {
      setState(normalizeAgentStoreState(nextState))
      loadedRef.current = true
    })
  }, [])

  useEffect(() => {
    return window.platform.agents.onRuntimeStateChanged((nextSnapshot) => {
      setRuntimeSnapshot(nextSnapshot as AgentSessionRuntimeSnapshot)
      loadedRef.current = true
    })
  }, [])

  useEffect(() => {
    return window.platform.agents.onChannelRuntimeStateChanged((nextSnapshot) => {
      setChannelRuntimeSnapshot(nextSnapshot as AgentChannelRuntimeSnapshot)
      loadedRef.current = true
    })
  }, [])

  useEffect(() => {
    const nextMinimum = getAgentPageMinimumSize(showSidebar)
    void window.platform.window.setMinimumSize(nextMinimum.width, nextMinimum.height)

    return () => {
      void window.platform.window.resetMinimumSize()
    }
  }, [showSidebar])

  return (
    <AgentTextProvider language={language}>
      <section className="agent-page">
        <AgentNavbar
          showSidebar={showSidebar}
          sessionPanelPosition={agentSettings.sessionPanelPosition}
          chatSettings={chatSettings}
          onToggleSidebar={() => setShowSidebar((current) => !current)}
          onOpenSidePanelDrawer={() => setSidePanelDrawerOpen(true)}
          onToggleNarrowMode={() =>
            void onUpdateSettings({ chat: { ...chatSettings, narrowMode: !chatSettings.narrowMode } })
          }
          onSearch={() => setIsSearchOpen(true)}
        />
        <div
          className={[
            'agent-page-body',
            showSidebar ? 'with-sidebar' : '',
            agentSettings.sessionPanelPosition === 'right' ? 'sidebar-right' : ''
          ]
            .filter(Boolean)
            .join(' ')}>
          {showSidebar ? (
            <AgentSidePanel
              state={state}
              runtimeStateBySessionId={runtimeSnapshot.sessions}
              channelRuntimeSnapshot={channelRuntimeSnapshot}
              sessionPanelPosition={agentSettings.sessionPanelPosition}
              onUpdateSessionPanelPosition={(sessionPanelPosition) =>
                onUpdateSettings({ agent: { ...agentSettings, sessionPanelPosition } })
              }
              onCreateAgent={() => setEditorMode({ type: 'create' })}
              onEditAgent={(agentId) => setEditorMode({ type: 'edit', agentId })}
              defaultAgentModelId={defaultAgentModelId}
              onStateChange={updateState}
            />
          ) : null}
        <AgentChat
          state={state}
          runtimeSnapshot={runtimeSnapshot}
          channelRuntimeSnapshot={channelRuntimeSnapshot}
          providers={providers}
          pinnedModelIds={pinnedModelIds}
          chatSettings={chatSettings}
          gatewaySnapshot={gateway.snapshot}
          compatibilityByModelKey={compatibilityByModelKey}
          defaultAgentModelId={defaultAgentModelId}
          loadingModelService={loadingModelService}
          gatewayStatusCard={
            <AgentModelGatewayStatusCard
              snapshot={gateway.snapshot}
              busy={gateway.busy}
              modelLabel={state.agents.find((agent) => agent.id === state.activeAgentId)?.modelName ?? undefined}
              onStart={() =>
                void gateway.start(activeAgentModelRef?.providerId, activeAgentModelRef?.modelId)
              }
              onStop={() => void gateway.stop()}
              onOpenModelService={() =>
                window.dispatchEvent(
                  new CustomEvent('app-shell:navigate', {
                    detail: { navKey: 'settings', settingsPanelKey: 'models' }
                  })
                )
              }
            />
          }
          onStateChange={updateState}
          onRuntimeSnapshotChange={setRuntimeSnapshot}
          onChannelRuntimeSnapshotChange={setChannelRuntimeSnapshot}
          onEditAgent={(agentId) => setEditorMode({ type: 'edit', agentId })}
        />
        </div>
        <AgentSearchModal
          open={isSearchOpen}
          state={state}
          onClose={() => setIsSearchOpen(false)}
          onSelectAgent={(agentId) => {
            void selectAgentViaApi(window.platform, agentId)
              .then((nextState) => {
                setState(nextState)
                loadedRef.current = true
                setIsSearchOpen(false)
              })
              .catch(() => {
                setIsSearchOpen(false)
              })
          }}
          onSelectSession={(sessionId) => {
            void selectSessionViaApi(window.platform, sessionId)
              .then((nextState) => {
                setState(nextState)
                loadedRef.current = true
                setIsSearchOpen(false)
              })
              .catch(() => {
                updateState((current) => selectSession(current, sessionId))
                setIsSearchOpen(false)
              })
          }}
        />
        <AgentSidePanelDrawer
          open={sidePanelDrawerOpen}
          state={state}
          runtimeStateBySessionId={runtimeSnapshot.sessions}
          channelRuntimeSnapshot={channelRuntimeSnapshot}
          sessionPanelPosition={agentSettings.sessionPanelPosition}
          onClose={() => setSidePanelDrawerOpen(false)}
          onUpdateSessionPanelPosition={(sessionPanelPosition) =>
            onUpdateSettings({ agent: { ...agentSettings, sessionPanelPosition } })
          }
          onCreateAgent={() => setEditorMode({ type: 'create' })}
          onEditAgent={(agentId) => {
            setEditorMode({ type: 'edit', agentId })
            setSidePanelDrawerOpen(false)
          }}
          defaultAgentModelId={defaultAgentModelId}
          onStateChange={(updater) => {
            updateState(updater)
            setSidePanelDrawerOpen(false)
          }}
        />
        {editorMode.type !== 'closed' ? (
          <AgentConfigPage
            mode={editorMode}
            state={state}
            providers={providers}
            defaultModelId={defaultAgentModelId}
            compatibilityByModelKey={compatibilityByModelKey}
            onStateChange={updateState}
            onClose={() => setEditorMode({ type: 'closed' })}
          />
        ) : null}
      </section>
    </AgentTextProvider>
  )
}
