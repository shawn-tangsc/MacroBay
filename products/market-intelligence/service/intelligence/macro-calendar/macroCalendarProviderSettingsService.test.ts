import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarProviderSettingsService } from './macroCalendarProviderSettingsService'


type ServiceDeps = Parameters<typeof createMacroCalendarProviderSettingsService>[0]
type ProfileStore = ServiceDeps['profiles']
type HealthStore = ServiceDeps['health']
type JobRuntime = ServiceDeps['jobs']

/**
 * 三个端口按**真实签名**建桩：`profiles` 是 `list + save` 两个方法（以前只给了 `list`），
 * 健康与作业的返回值也按端口类型收，不在调用点用 `as` 抹平。故意喂非法结果的用例仍会显式
 * `as never`——那是"输入本身不合法"的声明，不是绕过类型检查。
 */
function profileStore(list: () => Promise<unknown>, save?: ProfileStore['save']): ProfileStore {
  // 这些用例喂进去的正是"不可信的依赖值"（有的根本不合契约，服务必须自己拒绝），所以入参按
  // `unknown` 收；到了端口边界一次性落到契约类型，由服务做运行时校验——不是放宽断言。
  return {
    list: vi.fn(async () => (await list()) as Awaited<ReturnType<ProfileStore['list']>>),
    save: vi.fn(save ?? (async (input) => ({ ...input, updatedAt: '2026-08-05T00:00:00.000Z' })))
  }
}
function healthStore(getCurrent: HealthStore['getCurrent'] = () => undefined): HealthStore {
  return { getCurrent: vi.fn(getCurrent) }
}
function jobRuntime(overrides: Partial<JobRuntime> = {}): JobRuntime {
  const jobs: JobRuntime = {
    initialize: vi.fn(async () => undefined),
    runProviderNow: vi.fn(async () => ({ state: 'queued' as const })),
    ...overrides
  }
  return jobs
}

describe('macroCalendarProviderSettingsService', () => {
  it('returns fixed default-disabled Fed and BEA cards in product order', async () => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => []),
      health: healthStore(),
      jobs: jobRuntime()
    })

    await expect(service.getPageState()).resolves.toEqual({
      state: 'available',
      providers: [
        { providerId: 'macro-calendar-fed', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 },
        { providerId: 'macro-calendar-bea', enabled: false, scheduleHealth: 'never-run', consecutiveFailures: 0 }
      ]
    })
  })

  it.each([
    { sourceUrl: 'https://secret.example.test/?credential=raw' },
    'not-a-profile-list',
    null
  ])('rejects a malformed profile list without leaking its runtime fields', async (profiles) => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => profiles as never),
      health: healthStore(),
      jobs: jobRuntime()
    })

    const result = await service.getPageState()

    expect(result).toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
    expect(JSON.stringify(result)).not.toMatch(/https?:|credential|raw/i)
  })

  it('saves a fixed enabled provider, reconciles jobs, and rejects a disabled run without enqueueing', async () => {
    let enabled = false
    const save = vi.fn(async (input: { providerId: string; enabled: boolean }) => ({ ...input, updatedAt: '2026-08-05T00:00:00.000Z' })) as unknown as ProfileStore['save']
    const initialize = vi.fn(async () => undefined)
    const runProviderNow = vi.fn(async () => ({ state: 'queued' as const }))
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => enabled ? [{ providerId: 'macro-calendar-bea', enabled: true }] : [], async (input) => { enabled = input.enabled; return save(input) }),
      health: healthStore(),
      jobs: jobRuntime({ initialize, runProviderNow })
    })

    await expect(service.saveProfile({ providerId: 'macro-calendar-bea', enabled: true })).resolves.toEqual({
      state: 'saved',
      provider: { providerId: 'macro-calendar-bea', enabled: true, scheduleHealth: 'never-run', consecutiveFailures: 0 }
    })
    await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'skipped', failureCode: 'provider-disabled' })
    // 读者动作写 `decidedBy: 'reader'`：自动启用下次就不许翻回去。
    expect(save).toHaveBeenCalledWith({ providerId: 'macro-calendar-bea', enabled: true, decidedBy: 'reader' })
    expect(initialize).toHaveBeenCalledOnce()
    expect(runProviderNow).not.toHaveBeenCalled()
  })

  it('reconstructs safe health only and returns unavailable on secret-bearing dependency state', async () => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => [{ providerId: 'macro-calendar-fed', enabled: true, updatedAt: '2026-08-05T00:00:00.000Z' }]),
      // 这条健康值**故意**带凭据字段：服务必须把它判成不可用，不得回显。
      health: healthStore(() => ({ status: 'healthy', lastSuccessAt: '2026-08-05T00:00:00.000Z', consecutiveFailures: 0, sourceUrl: 'https://secret.example.test' }) as never),
      jobs: jobRuntime()
    })

    await expect(service.getPageState()).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })

  it('fails closed for a non-plain provider health dependency value', async () => {
    const foreignHealth = Object.assign(Object.create({ inherited: 'foreign' }), {
      providerId: 'macro-calendar-fed', status: 'healthy', updatedAt: '2026-08-05T00:00:00.000Z',
      consecutiveFailures: 0, lastSuccessAt: '2026-08-05T00:00:00.000Z', lastFailureAt: undefined,
      checkpoint: {}, safeSummary: undefined
    })
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]),
      health: healthStore((providerId) => providerId === 'macro-calendar-fed' ? foreignHealth as never : undefined),
      jobs: jobRuntime()
    })

    await expect(service.getPageState()).resolves.toEqual({ state: 'unavailable', failureCode: 'provider-settings-unavailable' })
  })

  it.each([
    [{ state: 'completed', outcome: 'succeeded' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded' }],
    [{ state: 'completed', outcome: 'failed' }, { state: 'completed', providerId: 'macro-calendar-fed', outcome: 'failed' }]
  ])('maps an exact runtime completion outcome %j', async (runtimeResult, expected) => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]),
      health: healthStore(),
      jobs: jobRuntime({ runProviderNow: vi.fn(async () => runtimeResult as never) })
    })

    await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual(expected)
  })

  it('fails closed for an invalid accepted runtime result and a disabled profile after completion', async () => {
    const profiles = vi.fn()
      .mockResolvedValueOnce([{ providerId: 'macro-calendar-fed', enabled: true }])
      .mockResolvedValueOnce([{ providerId: 'macro-calendar-fed', enabled: false }])
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(profiles),
      health: healthStore(),
      jobs: jobRuntime({ runProviderNow: vi.fn(async () => ({ state: 'completed', outcome: 'succeeded' } as never)) })
    })

    await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })

    profiles.mockResolvedValueOnce([{ providerId: 'macro-calendar-fed', enabled: true }])
    const invalid = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]),
      health: healthStore(),
      jobs: jobRuntime({ runProviderNow: vi.fn(async () => ({ state: 'completed', providerId: 'macro-calendar-fed', outcome: 'succeeded', extra: 'secret' } as never)) })
    })
    await expect(invalid.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'provider-settings-unavailable' })
  })

  it('derives the compact shared macro schedule rule from the runtime policy', async () => {
    const service = createMacroCalendarProviderSettingsService({
      profiles: profileStore(async () => []),
      health: healthStore(),
      jobs: jobRuntime()
    }) as unknown as { getProviderSchedule: (providerId: unknown) => Promise<unknown> }

    await expect(service.getProviderSchedule('macro-calendar-fed')).resolves.toEqual({
      state: 'available', providerId: 'macro-calendar-fed', schedule: {
        mode: 'interval', intervalSeconds: 21_600, anchor: 'last-complete', startupCatchUp: true, runNowAvailable: true
      }
    })
  })
})
