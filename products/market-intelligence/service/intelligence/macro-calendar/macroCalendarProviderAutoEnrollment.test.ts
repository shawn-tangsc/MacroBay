import { describe, expect, it, vi } from 'vitest'

import type { MacroCalendarProviderId } from './macroCalendarContracts'
import { autoEnrollCalendarProviders, credentialFreeCalendarProviders, isCredentialFreeCalendarProvider } from './macroCalendarProviderAutoEnrollment'
import type { MacroCalendarProviderProfile } from './macroCalendarProviderProfile'
import { createInMemoryMacroCalendarProviderProfileStorage, createMacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'

const profile = (providerId: MacroCalendarProviderId, enabled: boolean, decidedBy: 'auto' | 'reader' = 'auto'): MacroCalendarProviderProfile =>
  ({ providerId, enabled, decidedBy, updatedAt: '2026-08-01T00:00:00.000Z' })

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

  // 架构师的形状：`decidedBy` 记住「最后一次写 enabled 的是谁」。读者关掉的不许被下次启动翻回去。
  it('never reopens a provider the reader turned off', async () => {
    const s = store([profile('macro-calendar-fed', false, 'reader'), profile('macro-calendar-bea', false, 'reader'), profile('macro-calendar-bls', false, 'reader')])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect(enabled).toEqual([])
    expect(s.save).not.toHaveBeenCalled()
  })

  it('enables a provider that was never persisted', async () => {
    const s = store([])
    const enabled = await autoEnrollCalendarProviders({ profiles: s, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect([...enabled].sort()).toEqual(['macro-calendar-bea', 'macro-calendar-bls', 'macro-calendar-fed'])
  })

  // 老文件（只有 `enabled:false`、没有 `decidedBy`）→ 推断成读者写的 → **两次启动都仍然关**。
  // 这条专抓「推断只在内存、写回时丢了」：第二次启动读的是第一次写回的文件。
  it('keeps an old disabled file row closed across two boots, and writes the inferred decision back', async () => {
    const storage = createInMemoryMacroCalendarProviderProfileStorage([{ providerId: 'macro-calendar-fed', enabled: false, updatedAt: '2026-08-01T00:00:00.000Z' }])
    const first = createMacroCalendarProviderProfileStore(storage)
    const firstBoot = await autoEnrollCalendarProviders({ profiles: first, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect(firstBoot).not.toContain('macro-calendar-fed')
    // 写回之后文件里必须带上 `decidedBy: 'reader'`（推断结果落盘，不是只在内存里）。
    const persisted = await storage.readAll()
    expect(persisted.find(row => row.providerId === 'macro-calendar-fed')?.decidedBy).toBe('reader')
    const second = createMacroCalendarProviderProfileStore(storage)
    const secondBoot = await autoEnrollCalendarProviders({ profiles: second, readyProviderIds: [...credentialFreeCalendarProviders] })
    expect(secondBoot).not.toContain('macro-calendar-fed')
    expect((await second.list()).find(row => row.providerId === 'macro-calendar-fed')?.enabled).toBe(false)
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
