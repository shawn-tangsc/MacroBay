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
  it('enables BEA and BLS on first run when their runtime is ready, and leaves Fed alone', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect([...enabled].sort()).toEqual(['macro-calendar-bea', 'macro-calendar-bls'])
    expect(s.profiles.find(candidate => candidate.providerId === 'macro-calendar-bea')?.enabled).toBe(true)
    expect(s.profiles.find(candidate => candidate.providerId === 'macro-calendar-bls')?.enabled).toBe(true)
    // Fed 不在自动列表里：默认值不是它，读者自己的开关原样保留。
    expect(s.profiles.find(candidate => candidate.providerId === 'macro-calendar-fed')?.enabled).toBe(false)
  })

  it('does not enable a provider whose runtime dependency was missing this boot', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-fed'] })
    expect(enabled).toEqual([])
    expect(s.profiles.every(candidate => !candidate.enabled)).toBe(true)
    expect(s.save).not.toHaveBeenCalled()
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
