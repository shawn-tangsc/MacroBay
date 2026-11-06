import { describe, expect, it } from 'vitest'

import {
  AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS,
  AGENT_MODEL_REQUEST_TIMEOUT_HEADER,
  AGENT_MODEL_REQUEST_TIMEOUT_MAX_MS,
  formatAgentModelRequestTimeoutHeader,
  parseAgentModelRequestTimeoutHeader
} from './agentModelRequestBudget'

describe('agentModelRequestBudget', () => {
  it('treats an absent header as "the caller declared nothing"', () => {
    expect(parseAgentModelRequestTimeoutHeader(undefined)).toEqual({ state: 'absent' })
  })

  it('reads a declared budget in milliseconds', () => {
    expect(parseAgentModelRequestTimeoutHeader('240000')).toEqual({
      state: 'declared',
      timeoutMs: 240_000
    })
    expect(parseAgentModelRequestTimeoutHeader(' 90000 ')).toEqual({
      state: 'declared',
      timeoutMs: 90_000
    })
  })

  it('rejects a declaration it cannot honor instead of guessing', () => {
    for (const value of ['', '240', '-1', '1.5', '30s', '0']) {
      expect(parseAgentModelRequestTimeoutHeader(value).state).toBe('invalid')
    }
    expect(
      parseAgentModelRequestTimeoutHeader(String(AGENT_MODEL_REQUEST_TIMEOUT_MAX_MS + 1)).state
    ).toBe('invalid')
  })

  it('rejects repeated headers rather than picking one of them', () => {
    expect(parseAgentModelRequestTimeoutHeader(['240000'])).toEqual({
      state: 'declared',
      timeoutMs: 240_000
    })
    expect(parseAgentModelRequestTimeoutHeader(['240000', '60000']).state).toBe('invalid')
  })

  it('formats the header the way the provider environment sends it', () => {
    expect(formatAgentModelRequestTimeoutHeader(120_000)).toBe(
      `${AGENT_MODEL_REQUEST_TIMEOUT_HEADER}: 120000`
    )
    const parsed = parseAgentModelRequestTimeoutHeader(
      formatAgentModelRequestTimeoutHeader(120_000).slice(AGENT_MODEL_REQUEST_TIMEOUT_HEADER.length + 2)
    )
    expect(parsed).toEqual({ state: 'declared', timeoutMs: 120_000 })
  })

  it('keeps the fallback below the largest budget a caller may declare', () => {
    // The fallback is what an undeclared request gets; a declared budget may be larger, which is
    // the whole point — the old 60-second value used to be a cap for everyone.
    expect(AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS).toBe(60_000)
    expect(AGENT_MODEL_REQUEST_TIMEOUT_MAX_MS).toBeGreaterThan(AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS)
  })
})
