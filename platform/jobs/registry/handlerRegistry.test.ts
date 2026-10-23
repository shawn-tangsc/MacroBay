import { describe, expect, it } from 'vitest'

import { createHandlerRegistry } from './handlerRegistry'

describe('handlerRegistry', () => {
  it('throws when invoking an unregistered handler', async () => {
    const registry = createHandlerRegistry()

    await expect(registry.invoke('missing-handler', {}, createContext())).rejects.toThrow(
      'Unknown job handler "missing-handler".'
    )
  })

  it('registers and invokes a handler', async () => {
    const registry = createHandlerRegistry()
    const calls: string[] = []

    registry.register('test-handler', async (payload) => {
      calls.push(String(payload))
    })

    await registry.invoke('test-handler', 'hello', createContext())
    expect(calls).toEqual(['hello'])
  })

  it('throws when registering the same handler id twice', () => {
    const registry = createHandlerRegistry()
    registry.register('duplicate', async () => {})

    expect(() => registry.register('duplicate', async () => {})).toThrow(
      'Job handler "duplicate" is already registered.'
    )
  })

  it('reports whether a handler is registered', () => {
    const registry = createHandlerRegistry()
    expect(registry.has('absent')).toBe(false)

    registry.register('present', async () => {})
    expect(registry.has('present')).toBe(true)
  })
})

function createContext() {
  return {
    jobRunId: 'run-1',
    signal: new AbortController().signal,
    log: async () => {},
    progress: async () => {}
  }
}
