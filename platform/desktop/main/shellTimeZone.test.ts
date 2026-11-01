import { describe, expect, it, vi } from 'vitest'

import {
  createShellTimeZoneProvider,
  isUsableTimeZone,
  readSystemTimeZone,
  resolveTimeZoneSetting
} from './shellTimeZone'

describe('shellTimeZone', () => {
  it('prefers an explicit time zone and falls back to the system one', () => {
    expect(resolveTimeZoneSetting('Europe/Berlin', 'Asia/Shanghai')).toBe('Europe/Berlin')
    expect(resolveTimeZoneSetting('system', 'Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(resolveTimeZoneSetting(undefined, 'Asia/Shanghai')).toBe('Asia/Shanghai')
  })

  it('never hands a bad id to the schedulers', () => {
    expect(resolveTimeZoneSetting('Mars/Olympus_Mons', 'Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(resolveTimeZoneSetting('Mars/Olympus_Mons', 'also-not-a-zone')).toBe('UTC')
    expect(isUsableTimeZone('system')).toBe(false)
    expect(isUsableTimeZone('Asia/Tokyo')).toBe(true)
    expect(readSystemTimeZone()).not.toBe('')
  })

  it('starts from the system zone and picks the saved setting up on refresh', async () => {
    let saved: string = 'system'
    const provider = createShellTimeZoneProvider({
      settings: { get: async () => ({ timeZone: saved }) },
      systemTimeZone: () => 'Asia/Shanghai'
    })

    expect(provider.get()).toBe('Asia/Shanghai')

    saved = 'Asia/Tokyo'
    await expect(provider.refresh()).resolves.toBe('Asia/Tokyo')
    expect(provider.get()).toBe('Asia/Tokyo')

    saved = 'system'
    await provider.refresh()
    expect(provider.get()).toBe('Asia/Shanghai')
  })

  it('reads the setting once per refresh, not per get', async () => {
    const get = vi.fn(async () => ({ timeZone: 'Asia/Tokyo' }))
    const provider = createShellTimeZoneProvider({ settings: { get }, systemTimeZone: () => 'UTC' })

    await provider.refresh()
    provider.get()
    provider.get()

    expect(get).toHaveBeenCalledTimes(1)
  })
})
