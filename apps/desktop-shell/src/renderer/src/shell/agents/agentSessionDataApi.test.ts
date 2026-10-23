import { describe, expect, it, vi } from 'vitest'

import type { AgentSessionMessagesListQuery } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import {
  getAgentChannelRuntimeSnapshotViaApi,
  restartAgentChannelRuntimeViaApi,
  createAgentViaApi,
  clearSessionMessagesViaApi,
  createSessionViaApi,
  deleteAgentViaApi,
  deleteSessionMessageViaApi,
  deleteSessionsViaApi,
  listSessionMessagesViaApi,
  cancelSessionViaApi,
  reorderSessionsViaApi,
  saveAgentConfigViaApi,
  selectSessionViaApi,
  selectAgentViaApi,
  setAgentToolEnabledViaApi,
  setAgentViaApi,
  setSessionWorkspaceViaApi,
  switchSessionPinStateViaApi,
  updateSessionViaApi
} from './agentSessionDataApi'

describe('agent session data api', () => {
  it('selects a session through the new platform IPC and returns the updated store snapshot', async () => {
    const nextState = { activeSessionId: 'session-2', activeAgentId: 'agent-2' } as AgentStoreState
    const selectSession = vi.fn(async () => nextState)

    const result = await selectSessionViaApi(
      { agents: { selectSession } } as unknown as Window['platform'],
      'session-2'
    )

    expect(selectSession).toHaveBeenCalledWith('session-2')
    expect(result).toBe(nextState)
  })

  it('reads the channel runtime snapshot through the platform IPC with diagnostics enabled', async () => {
    const getChannelRuntimeSnapshot = vi.fn(async () => ({ channels: [{ channelId: 'channel-1' }] }))

    const result = await getAgentChannelRuntimeSnapshotViaApi(
      { agents: { getChannelRuntimeSnapshot } } as unknown as Window['platform']
    )

    expect(getChannelRuntimeSnapshot).toHaveBeenCalledWith({ includeDiagnostics: true })
    expect(result).toEqual({ channels: [{ channelId: 'channel-1' }] })
  })

  it('restarts channel runtime through the platform IPC', async () => {
    const restartChannelRuntime = vi.fn(async () => ({ channels: [{ channelId: 'channel-1', runtimeState: 'connecting' }] }))

    const result = await restartAgentChannelRuntimeViaApi(
      { agents: { restartChannelRuntime } } as unknown as Window['platform'],
      'channel-1'
    )

    expect(restartChannelRuntime).toHaveBeenCalledWith('channel-1')
    expect(result).toEqual({ channels: [{ channelId: 'channel-1', runtimeState: 'connecting' }] })
  })

  it('updates sessions through the platform IPC', async () => {
    const updateSession = vi.fn(async () => ({ id: 'session-2', name: 'Renamed' }))

    const result = await updateSessionViaApi(
      { agents: { updateSession } } as unknown as Window['platform'],
      'session-2',
      { name: 'Renamed' }
    )

    expect(updateSession).toHaveBeenCalledWith('session-2', { name: 'Renamed' })
    expect(result).toEqual({ id: 'session-2', name: 'Renamed' })
  })

  it('creates sessions through the platform IPC', async () => {
    const createSession = vi.fn(async () => ({ id: 'session-3', name: 'New Session' }))

    const result = await createSessionViaApi(
      { agents: { createSession } } as unknown as Window['platform'],
      { agentId: 'agent-1', name: 'New Session', workspace: { type: 'system' } }
    )

    expect(createSession).toHaveBeenCalledWith({ agentId: 'agent-1', name: 'New Session', workspace: { type: 'system' } })
    expect(result).toEqual({ id: 'session-3', name: 'New Session' })
  })

  it('deletes sessions through the platform IPC', async () => {
    const deleteSessions = vi.fn(async () => ({ deletedIds: ['session-2'] }))

    const result = await deleteSessionsViaApi(
      { agents: { deleteSessions } } as unknown as Window['platform'],
      ['session-2']
    )

    expect(deleteSessions).toHaveBeenCalledWith(['session-2'])
    expect(result).toEqual({ deletedIds: ['session-2'] })
  })

  it('lists paged session messages through the platform IPC', async () => {
    const query: AgentSessionMessagesListQuery = { cursor: '123:message-2', limit: 20 }
    const listSessionMessages = vi.fn(async () => ({ items: [{ id: 'message-1' }], nextCursor: undefined }))

    const result = await listSessionMessagesViaApi(
      { agents: { listSessionMessages } } as unknown as Window['platform'],
      'session-1',
      query
    )

    expect(listSessionMessages).toHaveBeenCalledWith('session-1', query)
    expect(result).toEqual({ items: [{ id: 'message-1' }], nextCursor: undefined })
  })

  it('clears and deletes messages through the platform IPC', async () => {
    const clearSessionMessages = vi.fn(async () => nextState())
    const deleteSessionMessage = vi.fn(async () => nextState())

    const cleared = await clearSessionMessagesViaApi(
      { agents: { clearSessionMessages } } as unknown as Window['platform'],
      'session-1'
    )
    const deleted = await deleteSessionMessageViaApi(
      { agents: { deleteSessionMessage } } as unknown as Window['platform'],
      'session-1',
      'message-1'
    )

    expect(clearSessionMessages).toHaveBeenCalledWith('session-1')
    expect(deleteSessionMessage).toHaveBeenCalledWith('session-1', 'message-1')
    expect(cleared).toEqual(nextState())
    expect(deleted).toEqual(nextState())
  })

  it('cancels the active session run through the platform IPC', async () => {
    const cancelSession = vi.fn(async () => true)

    const result = await cancelSessionViaApi(
      { agents: { cancelSession } } as unknown as Window['platform'],
      'session-1'
    )

    expect(cancelSession).toHaveBeenCalledWith('session-1')
    expect(result).toBe(true)
  })

  it('toggles session pin state through the platform IPC', async () => {
    const switchSessionPinState = vi.fn(async () => nextState())

    const result = await switchSessionPinStateViaApi(
      { agents: { switchSessionPinState } } as unknown as Window['platform'],
      'session-1'
    )

    expect(switchSessionPinState).toHaveBeenCalledWith('session-1')
    expect(result).toEqual(nextState())
  })

  it('reorders sessions through the platform IPC', async () => {
    const reorderSessions = vi.fn(async () => nextState())

    const result = await reorderSessionsViaApi(
      { agents: { reorderSessions } } as unknown as Window['platform'],
      ['session-2', 'session-1']
    )

    expect(reorderSessions).toHaveBeenCalledWith(['session-2', 'session-1'])
    expect(result).toEqual(nextState())
  })

  it('rebinds session workspace through the platform IPC', async () => {
    const setSessionWorkspace = vi.fn(async () => ({ id: 'session-1', workspaceId: 'workspace-2' }))

    const result = await setSessionWorkspaceViaApi(
      { agents: { setSessionWorkspace } } as unknown as Window['platform'],
      'session-1',
      { type: 'user', workspaceId: 'workspace-2' }
    )

    expect(setSessionWorkspace).toHaveBeenCalledWith('session-1', { type: 'user', workspaceId: 'workspace-2' })
    expect(result).toEqual({ id: 'session-1', workspaceId: 'workspace-2' })
  })

  it('updates an agent through the platform IPC', async () => {
    const updateAgent = vi.fn(async () => ({ id: 'agent-1', model: 'provider:model-b' }))

    const result = await setAgentViaApi(
      { agents: { updateAgent } } as unknown as Window['platform'],
      'agent-1',
      { model: 'provider:model-b' }
    )

    expect(updateAgent).toHaveBeenCalledWith('agent-1', { model: 'provider:model-b' })
    expect(result).toEqual({ id: 'agent-1', model: 'provider:model-b' })
  })

  it('updates disabled built-in tools through canonical agent IPC', async () => {
    const updateAgent = vi.fn(async () => ({ id: 'agent-1', disabledTools: ['Bash'] }))

    const result = await setAgentToolEnabledViaApi(
      { agents: { updateAgent } } as unknown as Window['platform'],
      {
        id: 'agent-1',
        disabledTools: ['Read']
      } as never,
      'Bash',
      false
    )

    expect(updateAgent).toHaveBeenCalledWith('agent-1', { disabledTools: ['Read', 'Bash'] })
    expect(result).toEqual({ id: 'agent-1', disabledTools: ['Bash'] })
  })

  it('creates, selects, and deletes agents through the platform IPC', async () => {
    const createAgent = vi.fn(async () => ({ id: 'agent-2', name: 'Created' }))
    const selectAgent = vi.fn(async () => nextState())
    const deleteAgent = vi.fn(async () => nextState())

    const platform = { agents: { createAgent, selectAgent, deleteAgent } } as unknown as Window['platform']
    const created = await createAgentViaApi(platform, {
      type: 'claude-code',
      name: 'Created',
      model: 'provider:model-c'
    })
    const selected = await selectAgentViaApi(platform, 'agent-2')
    const deleted = await deleteAgentViaApi(platform, 'agent-2')

    expect(createAgent).toHaveBeenCalledWith({ type: 'claude-code', name: 'Created', model: 'provider:model-c' })
    expect(selectAgent).toHaveBeenCalledWith('agent-2')
    expect(deleteAgent).toHaveBeenCalledWith('agent-2')
    expect(created).toEqual({ id: 'agent-2', name: 'Created' })
    expect(selected).toEqual(nextState())
    expect(deleted).toEqual(nextState())
  })

  it('saves agent create intents through canonical IPC and creates the default session', async () => {
    const createAgent = vi.fn(async () => ({ id: 'agent-2', name: 'Created' }))
    const createSession = vi.fn(async () => ({ id: 'session-2', agentId: 'agent-2' }))
    const getState = vi.fn(async () => nextState())

    const result = await saveAgentConfigViaApi(
      { agents: { createAgent, createSession, getState } } as unknown as Window['platform'],
      {
        kind: 'create',
        payload: {
          type: 'claude-code',
          name: 'Created',
          model: 'provider:model-c'
        }
      },
      null
    )

    expect(createAgent).toHaveBeenCalledWith({ type: 'claude-code', name: 'Created', model: 'provider:model-c' })
    expect(createSession).toHaveBeenCalledWith({
      agentId: 'agent-2',
      name: 'Created',
      workspace: { type: 'system' }
    })
    expect(getState).toHaveBeenCalled()
    expect(result).toEqual(nextState())
  })

  it('saves agent update intents through canonical IPC', async () => {
    const updateAgent = vi.fn(async () => ({ id: 'agent-1', name: 'Updated' }))
    const getState = vi.fn(async () => nextState())

    const result = await saveAgentConfigViaApi(
      { agents: { updateAgent, getState } } as unknown as Window['platform'],
      { kind: 'update', payload: { name: 'Updated' } },
      'agent-1'
    )

    expect(updateAgent).toHaveBeenCalledWith('agent-1', { name: 'Updated' })
    expect(result).toEqual(nextState())
  })
})

function nextState(): AgentStoreState {
  return { activeSessionId: 'session-1', activeAgentId: 'agent-1' } as AgentStoreState
}
