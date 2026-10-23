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
  it('enables every ready credential-free provider that is still disabled', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect(enabled).toEqual([...credentialFreeCalendarProviders])
    expect(s.profiles.every(candidate => candidate.enabled)).toBe(true)
  })

  it('never enables a provider whose runtime dependency was not composed', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false), profile('macro-calendar-bls', false)])
    // No BEA release refresh and no BLS bridge this boot.
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-fed'] })
    expect(enabled).toEqual(['macro-calendar-fed'])
    expect(s.profiles.find(candidate => candidate.providerId === 'macro-calendar-bea')?.enabled).toBe(false)
    expect(s.profiles.find(candidate => candidate.providerId === 'macro-calendar-bls')?.enabled).toBe(false)
  })

  it('leaves an already enabled provider untouched, including its timestamp', async () => {
    const s = store([profile('macro-calendar-fed', true)])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-fed'] })
    expect(enabled).toEqual([])
    expect(s.save).not.toHaveBeenCalled()
    expect(s.profiles[0]?.updatedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('does not block other providers when one write fails', async () => {
    const s = store([profile('macro-calendar-fed', false), profile('macro-calendar-bea', false)])
    s.save.mockImplementationOnce(async () => { throw new Error('disk full') })
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: ['macro-calendar-fed', 'macro-calendar-bea'] })
    expect(enabled).toEqual(['macro-calendar-bea'])
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
