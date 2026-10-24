import { Drawer } from 'antd'

import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentSessionRuntimeStateBySessionId } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionPanelPosition } from '@platform/settings/schema/appSettings'

import AgentSidePanel from '../AgentSidePanel'

type AgentSidePanelDrawerProps = {
  open: boolean
  state: AgentStoreState
  runtimeStateBySessionId: AgentSessionRuntimeStateBySessionId
  channelRuntimeSnapshot: AgentChannelRuntimeSnapshot
  sessionPanelPosition: AgentSessionPanelPosition
  onClose: () => void
  onUpdateSessionPanelPosition: (position: AgentSessionPanelPosition) => void
  onCreateAgent: () => void
  onEditAgent: (agentId: string) => void
  defaultAgentModelId?: string
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

export default function AgentSidePanelDrawer({
  open,
  state,
  runtimeStateBySessionId,
  channelRuntimeSnapshot,
  sessionPanelPosition,
  onClose,
  onUpdateSessionPanelPosition,
  onCreateAgent,
  onEditAgent,
  defaultAgentModelId,
  onStateChange
}: AgentSidePanelDrawerProps): React.ReactElement {
  return (
    <Drawer
      open={open}
      placement="left"
      width={282}
      title={null}
      closeIcon={null}
      onClose={onClose}
      className="agent-side-panel-drawer"
      styles={{ body: { padding: 0 } }}>
      <AgentSidePanel
        state={state}
        runtimeStateBySessionId={runtimeStateBySessionId}
        channelRuntimeSnapshot={channelRuntimeSnapshot}
        sessionPanelPosition={sessionPanelPosition}
        onUpdateSessionPanelPosition={onUpdateSessionPanelPosition}
        onCreateAgent={onCreateAgent}
        onEditAgent={onEditAgent}
        defaultAgentModelId={defaultAgentModelId}
        onStateChange={onStateChange}
      />
    </Drawer>
  )
}
