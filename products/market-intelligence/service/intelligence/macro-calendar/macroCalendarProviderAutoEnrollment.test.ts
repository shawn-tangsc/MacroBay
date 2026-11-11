import { describe, expect, it, vi } from 'vitest'

import type { MacroCalendarProviderId } from './macroCalendarContracts'
import { autoEnrollCalendarProviders, credentialFreeCalendarProviders, isCredentialFreeCalendarProvider } from './macroCalendarProviderAutoEnrollment'
import type { MacroCalendarProviderProfile } from './macroCalendarProviderProfile'

const profile = (providerId: MacroCalendarProviderId, enabled: boolean): MacroCalendarProviderProfile =>
  ({ providerId, enabled, updatedAt: '2026-08-01T00:00:00.000Z' })

function store(initial: readonly MacroCalendarProviderProfile[]) {
  const profiles = [...initial]
  const save = vi.fn(async (input: { providerId: MacroCalendarProviderId; enabled: boolean }) => {
    const next = { ...profile(input.providerId, input.enabled), updatedAt: '2026-10-07T00:00:00.000Z' }
    const index = profiles.findIndex(candidate => candidate.providerId === input.providerId)
    if (index >= 0) profiles[index] = next
    else profiles.push(next)
    return next
  })
  return { profiles, save, list: vi.fn(async () => [...profiles]) }
}

describe('calendar provider auto enrollment', () => {
  // 读者 2026-11-12：Fed 与 BEA 两个官方日历默认启动（BLS 按自己的就绪判断走）。
  it('enables Fed, BEA and BLS on first run when their runtime is ready', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect([...enabled].sort()).toEqual(['macro-calendar-bea', 'macro-calendar-bls', 'macro-calendar-fed'])
    for (const providerId of ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'] as const) {
      expect(s.profiles.find(candidate => candidate.providerId === providerId)?.enabled, providerId).toBe(true)
    }
  })

  it('does not enable a provider whose runtime dependency was missing this boot', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-fed'] })
    // 只有就绪的那个被写；另外两个缺依赖的保持关闭（缺依赖的启动不许写成「开着但从不刷新」）。
    expect([...enabled]).toEqual(['macro-calendar-fed'])
    expect(s.profiles.filter(candidate => candidate.providerId !== 'macro-calendar-fed').every(candidate => !candidate.enabled)).toBe(true)
    // 只写就绪的那一个：缺依赖的两次启动都不许被写成「开着」。
    expect(s.save).toHaveBeenCalledTimes(1)
  })

  it('leaves an already enabled provider untouched, including its timestamp', async () => {
    const s = store([profile('macro-calendar-bea', true)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-bea'] })
    expect(enabled).toEqual([])
    expect(s.save).not.toHaveBeenCalled()
    expect(s.profiles[0]?.updatedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('keeps going for the other provider when one write fails', async () => {
    const s = store([profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    s.save.mockImplementationOnce(async () => { throw new Error('disk full') })
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-bea', 'macro-calendar-bls'] })
    // 第一条写失败不阻断第二条；返回的只有真正写成的那条。
    expect(enabled).toEqual(['macro-calendar-bls'])
    expect(s.profiles.find(candidate => candidate.providerId === 'macro-calendar-bls')?.enabled).toBe(true)
  })

  it('fails closed when the profile list cannot be read', async () => {
    const s = store([])
    s.list.mockRejectedValueOnce(new Error('unreadable'))
    await expect(autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-fed'] })).resolves.toEqual([])
    expect(s.save).not.toHaveBeenCalled()
  })

  it('keeps credentialed providers out of the auto-enabled set', () => {
    expect(isCredentialFreeCalendarProvider('macro-calendar-fed')).toBe(true)
    expect(isCredentialFreeCalendarProvider('macro-calendar-bea')).toBe(true)
    expect(isCredentialFreeCalendarProvider('macro-calendar-bls')).toBe(true)
    // The 0xRouter source is enabled through its own source profile because it
    // needs an API key; it must never arrive here.
    expect(isCredentialFreeCalendarProvider('macro-calendar-0xrouter' as MacroCalendarProviderId)).toBe(false)
  })
})
