import { describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@platform/jobs'

import {
  channelAdapterMaintenanceTypes,
  channelMaintenanceJobDefinitions,
  channelMaintenanceJobIds,
  registerChannelMaintenanceJobHandlers,
  scheduleChannelMaintenanceJobs,
  type ChannelMaintenanceJobDependencies
} from './channelMaintenanceJobs'

function dependencies(overrides: Partial<ChannelMaintenanceJobDependencies> = {}): ChannelMaintenanceJobDependencies {
  return {
    deliveryCleanup: vi.fn(),
    deliveryRetry: vi.fn(async () => {}),
    inboundRecovery: vi.fn(async () => {}),
    adapterMaintenance: Object.fromEntries(
      channelAdapterMaintenanceTypes.map((type) => [type, vi.fn()])
    ) as ChannelMaintenanceJobDependencies['adapterMaintenance'],
    ...overrides
  }
}

describe('channel maintenance jobs', () => {
  // Internal: the settings table lists resource jobs only, and none of these is user-facing work.
  it('注册的每条定义都是 internal，并且每类维护各有一条', () => {
    const definitions = channelMaintenanceJobDefinitions(dependencies())

    expect(definitions.every((definition) => definition.audience === 'internal')).toBe(true)
    expect(definitions.map((definition) => definition.id).sort()).toEqual(
      [
        channelMaintenanceJobIds.deliveryCleanup,
        channelMaintenanceJobIds.deliveryRetry,
        channelMaintenanceJobIds.inboundRecovery,
        ...channelAdapterMaintenanceTypes.map((type) => channelMaintenanceJobIds.adapterMaintenance(type))
      ].sort()
    )
  })

  it('registers one handler per definition and invokes the matching pass', async () => {
    const handlers = new Map<string, () => Promise<void>>()
    const deps = dependencies()
    const context: JobContext = {
      jobRunId: 'run-maintenance',
      signal: new AbortController().signal,
      log: async () => {},
      progress: async () => {}
    }
    registerChannelMaintenanceJobHandlers(
      { registerHandler: (id, handler) => { handlers.set(id, async () => { await handler({}, context) }) } },
      deps
    )

    expect([...handlers.keys()].sort()).toEqual(channelMaintenanceJobDefinitions(deps).map((item) => item.id).sort())

    await handlers.get(channelMaintenanceJobIds.deliveryCleanup)?.()
    await handlers.get(channelMaintenanceJobIds.deliveryRetry)?.()
    await handlers.get(channelMaintenanceJobIds.inboundRecovery)?.()
    await handlers.get(channelMaintenanceJobIds.adapterMaintenance('telegram'))?.()

    expect(deps.deliveryCleanup).toHaveBeenCalledTimes(1)
    expect(deps.deliveryRetry).toHaveBeenCalledTimes(1)
    expect(deps.inboundRecovery).toHaveBeenCalledTimes(1)
    expect(deps.adapterMaintenance.telegram).toHaveBeenCalledTimes(1)
    // Only the invoked adapter ran: one handler per independently toggled capability.
    expect(deps.adapterMaintenance.wechat).not.toHaveBeenCalled()
  })

  it('runs the first pass immediately, schedules every definition and removes exactly those', () => {
    const scheduled: string[] = []
    const removed: string[] = []
    const deps = dependencies()

    const dispose = scheduleChannelMaintenanceJobs(
      {
        setSchedule: (definition) => { scheduled.push(definition.id) },
        removeSchedule: (id) => { removed.push(id) }
      },
      deps
    )

    // A fresh start sweeps before the first interval, exactly as the timers did.
    expect(deps.deliveryCleanup).toHaveBeenCalledTimes(1)
    expect(deps.deliveryRetry).toHaveBeenCalledTimes(1)
    expect(deps.inboundRecovery).toHaveBeenCalledTimes(1)
    expect(deps.adapterMaintenance.lark).toHaveBeenCalledTimes(1)
    expect(scheduled.sort()).toEqual(channelMaintenanceJobDefinitions(deps).map((item) => item.id).sort())

    dispose()

    // Disabling the group leaves nothing registered: the disposer owns every id it scheduled.
    expect(removed.sort()).toEqual(scheduled.sort())
  })
})
