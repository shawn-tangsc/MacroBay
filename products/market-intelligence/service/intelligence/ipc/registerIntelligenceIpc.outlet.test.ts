import { describe, expect, it } from 'vitest'

import { parseOutletSwitchPayload } from './registerIntelligenceIpc'

describe('parseOutletSwitchPayload', () => {
  it('rejects a payload that does not say enabled as a boolean', () => {
    expect(() => parseOutletSwitchPayload({})).toThrow('enabled must be a boolean.')
    expect(() => parseOutletSwitchPayload({ enabled: 'true' })).toThrow('enabled must be a boolean.')
    expect(() => parseOutletSwitchPayload(null)).toThrow('enabled must be a boolean.')
  })

  it('takes the server clock when no instant is given, and accepts a readable ISO one', () => {
    const withDefault = parseOutletSwitchPayload({ enabled: true })
    expect(withDefault.enabled).toBe(true)
    expect(Number.isNaN(Date.parse(withDefault.at))).toBe(false)

    expect(parseOutletSwitchPayload({ enabled: false, at: '2026-11-06T22:50:00.000Z' })).toEqual({
      enabled: false,
      at: '2026-11-06T22:50:00.000Z'
    })
  })

  it('rejects an unreadable instant instead of silently falling back', () => {
    expect(() => parseOutletSwitchPayload({ enabled: true, at: 'not-a-date' })).toThrow(
      'at must be an ISO instant.'
    )
  })
})
