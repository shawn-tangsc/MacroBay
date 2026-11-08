import { describe, expect, it, vi } from 'vitest'

import type { JobDefinition } from '@platform/jobs'

import { blsScheduleAndValuesSchedulerPolicy, createBlsScheduleAndValuesScheduler } from './blsScheduleAndValuesScheduler'

/**
 * 这一份测试在 2026-11-08 被**重写**过：自动排期已停（用户拍板，原因见
 * `blsOfficialCalendarAvailability.ts`）。
 *
 * 被删掉的旧断言是「会排期 / 启动跑一次 / handler 会同步」——那正是现在不该发生的事。
 * 谁把排期加回去，这里的 `expect(...).toEqual([])` 会立刻红；新增「间隔到点会跑」的用例
 * 之前，先回读 `blsOfficialCalendarAvailability.ts` 里的判定与取证。
 */
function fakeRuntime(seed: readonly string[] = []) {
  const scheduled = new Set(seed)
  const calls = {
    registeredHandlers: [] as string[],
    scheduled: [] as string[],
    enqueued: [] as JobDefinition[],
    removed: [] as string[]
  }
  return {
    scheduled,
    calls,
    runtime: {
      registerHandler: (id: string) => {
        calls.registeredHandlers.push(id)
        return { dispose: () => undefined } as never
      },
      setSchedule: (definition: JobDefinition) => {
        calls.scheduled.push(definition.id)
        scheduled.add(definition.id)
      },
      removeSchedule: (id: string) => {
        calls.removed.push(id)
        scheduled.delete(id)
      },
      enqueueDefinition: async (definition: JobDefinition) => {
        calls.enqueued.push(definition)
        return {}
      },
      listSchedules: () => [...scheduled].map((id) => ({ id }))
    }
  }
}

function scheduler(runtime: ReturnType<typeof fakeRuntime>['runtime']) {
  return createBlsScheduleAndValuesScheduler({
    jobRuntime: runtime as never,
    workflow: { sync: vi.fn() },
    readEnabled: () => true,
    now: () => new Date('2026-11-08T00:00:00.000Z')
  })
}

describe('BLS official calendar automatic sync is stopped', () => {
  it('leaves no definition in listSchedules: stopping is not "scheduled but exits early"', () => {
    const { runtime, scheduled, calls } = fakeRuntime()
    scheduler(runtime).initialize()

    expect([...scheduled]).toEqual([])
    expect(calls.scheduled).toEqual([])
    expect(calls.enqueued).toEqual([])
    expect(calls.registeredHandlers).toEqual([])
  })

  it('removes the definition an earlier version persisted, so it cannot keep firing', () => {
    const id = blsScheduleAndValuesSchedulerPolicy.definitionId
    const { runtime, scheduled, calls } = fakeRuntime([id, 'some-other-job'])

    scheduler(runtime).initialize()

    expect(calls.removed).toEqual([id])
    expect([...scheduled]).toEqual(['some-other-job'])
  })

  it('keeps dispose removing the definition, so a shutdown cannot leave one behind', () => {
    const { runtime, calls } = fakeRuntime()
    const instance = scheduler(runtime)
    instance.initialize()
    instance.dispose()

    expect(calls.removed).toEqual([blsScheduleAndValuesSchedulerPolicy.definitionId, blsScheduleAndValuesSchedulerPolicy.definitionId])
  })
})
