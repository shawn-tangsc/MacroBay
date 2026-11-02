import { describe, expect, it } from 'vitest'

import {
  getAgentTaskExecutionCoordinator,
  getAgentTaskExecutionCoordinatorOrNull,
  getAgentTaskRunController,
  getDisposeChannelMaintenanceJobs,
  getDisposeJobRunRetention,
  getDisposeTaskAutomationMaintenance,
  getInstalledProductManifestIds,
  getJobRuntimeForDisposal,
  getPanelWorkspaceForDisposal,
  getProductIpcRegistryForDisposal,
  setAgentTaskExecutionCoordinator,
  setAgentTaskRunController,
  setDisposeChannelMaintenanceJobs,
  setDisposeJobRunRetention,
  setDisposeTaskAutomationMaintenance,
  setInstalledProductManifestIds,
  setJobRuntimeForDisposal,
  setPanelWorkspaceForDisposal,
  setProductIpcRegistryForDisposal
} from './slots'

describe('composition slots', () => {
  it('round-trips every mutable slot: the same reference comes back out', () => {
    const coordinator = { id: 'coordinator' } as never
    const jobRuntime = { id: 'job-runtime' } as never
    const registry = { id: 'product-ipc' } as never
    const workspace = { id: 'workspace' } as never
    const taskAutomationDispose = () => undefined
    const retentionDispose = () => undefined
    const channelDispose = () => undefined
    const controller = { id: 'task-run-controller' } as never

    setAgentTaskExecutionCoordinator(coordinator)
    setJobRuntimeForDisposal(jobRuntime)
    setProductIpcRegistryForDisposal(registry)
    setPanelWorkspaceForDisposal(workspace)
    setDisposeTaskAutomationMaintenance(taskAutomationDispose)
    setDisposeJobRunRetention(retentionDispose)
    setDisposeChannelMaintenanceJobs(channelDispose)
    setInstalledProductManifestIds(['manifest-1'])
    setAgentTaskRunController(controller)

    expect(getAgentTaskExecutionCoordinator()).toBe(coordinator)
    expect(getAgentTaskExecutionCoordinatorOrNull()).toBe(coordinator)
    expect(getJobRuntimeForDisposal()).toBe(jobRuntime)
    expect(getProductIpcRegistryForDisposal()).toBe(registry)
    expect(getPanelWorkspaceForDisposal()).toBe(workspace)
    expect(getDisposeTaskAutomationMaintenance()).toBe(taskAutomationDispose)
    expect(getDisposeJobRunRetention()).toBe(retentionDispose)
    expect(getDisposeChannelMaintenanceJobs()).toBe(channelDispose)
    expect(getInstalledProductManifestIds()).toEqual(['manifest-1'])
    expect(getAgentTaskRunController()).toBe(controller)
  })

  it('throws when the execution coordinator is read before it is initialised', () => {
    setAgentTaskExecutionCoordinator(null)
    expect(getAgentTaskExecutionCoordinatorOrNull()).toBeNull()
    expect(() => getAgentTaskExecutionCoordinator()).toThrow('agent-task-execution-coordinator-before-init')
  })
})
