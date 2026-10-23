import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeDriver } from './runtimeTypes'
import { RuntimeDriverRegistry } from './RuntimeDriverRegistry'

function createDriver(): AgentRuntimeDriver {
  return {
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
    cancelSession: vi.fn()
  }
}

describe('runtime driver registry', () => {
  it('returns drivers by agent type', () => {
    const registry = new RuntimeDriverRegistry()
    const driver = createDriver()

    registry.register('claude-code', driver)

    expect(registry.get('claude-code')).toBe(driver)
    expect(registry.require('claude-code')).toBe(driver)
  })

  it('throws a clear error when a driver is missing', () => {
    const registry = new RuntimeDriverRegistry()

    expect(() => registry.require('claude-code')).toThrow('Runtime driver "claude-code" was not registered.')
  })

  it('replaces an existing driver registration for the same type', () => {
    const registry = new RuntimeDriverRegistry()
    const first = createDriver()
    const second = createDriver()

    registry.register('claude-code', first)
    registry.register('claude-code', second)

    expect(registry.require('claude-code')).toBe(second)
  })
})
